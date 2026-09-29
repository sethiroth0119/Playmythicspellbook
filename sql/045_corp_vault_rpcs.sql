-- ════════════════════════════════════════════════════════════════════════════
-- 045 — CORP VAULT: the ledger, and the only two functions allowed to write it
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify query that prints what exists.
--
-- WHY THIS FILE EXISTS AT ALL
--   `supabase-org-vault.sql` in the repo root already contains a version of
--   corp_vault_log / corp_vault_deposit / corp_vault_withdraw. It is UNNUMBERED,
--   it is not in /sql, and nothing records whether it was ever applied — so the
--   client cannot assume the functions are there and a reviewer cannot tell.
--   This is the numbered, idempotent re-issue: applying it makes the state known.
--   It is safe to run whether or not the older file was ever pasted.
--
-- 🔴 READ THIS BEFORE PASTING: AN EARLIER FORM OF THIS FILE IS ALREADY LIVE.
--   Verified against ktsiasyjusesawtrwrjc on 2026-08-21, read-only:
--     · corp_vault_deposit  EXISTS — 7 args, but `returns void` (this file
--       returns numeric).
--     · corp_vault_withdraw EXISTS — FIVE args (p_corp_id, p_kind, p_item_id,
--       p_qty, p_actor_name); this file's is seven, with the last two
--       defaulted, so the client's five NAMED arguments still resolve.
--     · is_corp_member does NOT exist. The deployed withdraw checks membership
--       with an inline `exists (select 1 from corp_members …)` instead — so
--       membership IS enforced today; what is missing is the shared helper.
--     · corp_vault_log EXISTS with all 13 columns below, and holds ZERO rows
--       game-wide against 24 corp_vault rows. No deposit or withdrawal has ever
--       been observed to go through either RPC: every live row's updated_at
--       sits ~0.5s after created_at, which is the signature of the client's
--       FALLBACK UPSERT, not of a function (whose insert leaves them equal).
--   So this is a REVISION of an applied migration, not a new one. It is still
--   safe to paste: section 4 drops the deployed 5-arg withdraw and the deployed
--   7-arg deposit by exact signature before creating the new ones, so no
--   overload is left behind for PostgREST to pick between.
--   ⚠ `create table if not exists` guarantees NOTHING about columns on a
--   database that already has the table in an older shape. The add-column
--   block after the create exists for that case; on THIS database every column
--   is already present and the block is a no-op.
--
-- 🔴 WHY WITHDRAWAL IS AN RPC AND NOT AN RLS POLICY
--   corp_vault today has exactly one UPDATE policy: `depositor_id = auth.uid()`.
--   That means only the player who deposited an item can ever touch it — a
--   shared vault nobody else can draw from is a personal stash with an audience.
--   The obvious fix, widening UPDATE to all members, is unsafe: a USING clause
--   cannot express "you may only DECREASE qty, by the amount you actually asked
--   for". A member could simply set qty to a million. It also cannot be done
--   atomically from the client, because corp_vault is keyed per DEPOSITOR and a
--   single withdrawal usually spans several rows.
--   So SECURITY DEFINER functions are the only write path for withdrawal: they
--   check membership, refuse to overdraw, drain oldest-deposit-first, and write
--   the ledger row in the SAME transaction. A movement can never be unlogged.
--
-- ⚠ RLS RECURSION. `is_corp_member` is SECURITY DEFINER precisely so a policy
--   that needs a membership test does not have to SELECT corp_members inside a
--   policy that could itself be evaluated against corp_members. SECURITY DEFINER
--   bypasses RLS and therefore terminates. Do NOT inline this test into a policy
--   on corp_members itself.
--
-- 🔴 IT ALSO CLOSES A LIVE HOLE THAT HAS NOTHING TO DO WITH THE FUNCTIONS.
--   Checked against the live database while writing this: `authenticated` and
--   `anon` hold TRUNCATE on corp_vault AND corp_vault_log. RLS does not apply to
--   TRUNCATE, so every carefully-reviewed policy below was moot — any signed-in
--   player could have emptied every corporation's vault in the game with one
--   statement. See section 3b.
--
-- ⚠ THE LEDGER IS APPEND-ONLY, per CLAUDE.md. Nobody gets INSERT/UPDATE/DELETE
--   on corp_vault_log — not even the row's own actor. Every row is written by a
--   function below, which bypasses RLS. Append-only by construction, not by
--   convention, so the history a member reads cannot be forged or edited.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. MEMBERSHIP HELPER ────────────────────────────────────────────────────
-- STABLE + SECURITY DEFINER. Used by the policies below and by every function
-- here, so "who is in this corporation" is decided in exactly one place.
create or replace function public.is_corp_member(p_corp_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_corp_id is not null
     and p_user_id is not null
     and (
       exists (select 1 from public.corp_members m
                where m.corp_id = p_corp_id and m.user_id = p_user_id)
       -- The founder is a member even when the corp_members row never landed.
       -- corpEnsure() in index.html already self-heals this case client-side;
       -- without the same allowance here a founder can be locked out of their
       -- own vault by a missing row they never see.
       or exists (select 1 from public.corporations c
                   where c.id = p_corp_id and c.founder_id = p_user_id)
     );
$$;

revoke all on function public.is_corp_member(uuid, uuid) from public, anon;
grant execute on function public.is_corp_member(uuid, uuid) to authenticated;


-- ── 2. THE LEDGER ───────────────────────────────────────────────────────────
-- Every movement of a corporation asset, in order. The Mailbox and Logistics
-- screens read this; 'send' / 'claim' / 'cancel' are written by the member-to-
-- member transfer RPCs that live in supabase-org-vault.sql and are kept in the
-- CHECK here so applying this file cannot invalidate rows those wrote.
create table if not exists public.corp_vault_log (
  id                bigserial primary key,
  corp_id           uuid not null references public.corporations(id) on delete cascade,
  actor_id          uuid references auth.users(id) on delete set null,
  actor_name        text,
  action            text not null check (action in ('deposit','withdraw','send','claim','cancel')),
  kind              text not null,
  item_id           text not null,
  name              text,
  icon              text,
  qty               numeric not null default 0,
  counterparty_id   uuid references auth.users(id) on delete set null,
  counterparty_name text,
  created_at        timestamptz not null default now()
);

-- ⚠ COLUMN SAFETY. `create table if not exists` above is a NO-OP on a database
-- that already has corp_vault_log — including one carrying an older, narrower
-- version of it. Idempotent is not the same as column-safe: without this block
-- the functions below would compile and then fail at runtime on the first
-- insert. Every column the two functions write is asserted here.
-- (On ktsiasyjusesawtrwrjc all 13 already exist; this block is a no-op there.)
alter table public.corp_vault_log add column if not exists actor_id          uuid references auth.users(id) on delete set null;
alter table public.corp_vault_log add column if not exists actor_name        text;
alter table public.corp_vault_log add column if not exists action            text;
alter table public.corp_vault_log add column if not exists kind              text;
alter table public.corp_vault_log add column if not exists item_id           text;
alter table public.corp_vault_log add column if not exists name              text;
alter table public.corp_vault_log add column if not exists icon              text;
alter table public.corp_vault_log add column if not exists qty               numeric not null default 0;
alter table public.corp_vault_log add column if not exists counterparty_id   uuid references auth.users(id) on delete set null;
alter table public.corp_vault_log add column if not exists counterparty_name text;
alter table public.corp_vault_log add column if not exists created_at        timestamptz not null default now();

create index if not exists corp_vault_log_corp on public.corp_vault_log (corp_id, created_at desc);

alter table public.corp_vault_log enable row level security;

-- Members of the corporation read their own corporation's ledger. Nobody else.
drop policy if exists cvl_sel on public.corp_vault_log;
create policy cvl_sel on public.corp_vault_log
  for select to authenticated
  using (public.is_corp_member(corp_vault_log.corp_id, auth.uid()));

-- No write policy exists for anyone, and the table privileges are removed on top
-- of that. Both, deliberately: a future `for all` policy added by mistake still
-- cannot write, because the GRANT is not there either.
revoke insert, update, delete on public.corp_vault_log from anon, authenticated;
grant select on public.corp_vault_log to authenticated;
-- bigserial owns a sequence; nobody may reach it directly. Guarded because a
-- table created by an older hand-run may have used `generated always as
-- identity` instead, in which case that sequence name does not exist and an
-- unguarded REVOKE would abort the whole migration on line 1 of a re-run.
do $$
begin
  if to_regclass('public.corp_vault_log_id_seq') is not null then
    execute 'revoke all on sequence public.corp_vault_log_id_seq from anon, authenticated';
  end if;
end $$;


-- ── 3. corp_vault — the conflict target, and a membership-based read ─────────
-- corp_vault itself is created by the legacy FOUNDATION_RESERVE_SQL block in
-- index.html. Everything here is defensive so this file is safe on a database
-- where that block ran at a different time.
alter table public.corp_vault enable row level security;

-- The deposit function's ON CONFLICT needs this exact unique key. Created only
-- when it is absent, so a database that already has the table constraint is
-- left alone rather than growing a duplicate index.
do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and t.relname = 'corp_vault' and i.indisunique
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(i.indkey) k
              join pg_attribute a on a.attrelid = t.oid and a.attnum = k)
           = array['corp_id','depositor_id','item_id','kind']
  ) then
    execute 'create unique index corp_vault_owner_item_uidx on public.corp_vault (corp_id, depositor_id, kind, item_id)';
  end if;
end $$;

-- READ: any member of the corporation sees the whole vault. This is what makes
-- "show the stuff that is in the vault" true for everyone rather than only for
-- the person who deposited it. Re-issued through the helper so the founder
-- self-heal case above applies here too.
drop policy if exists cv_sel on public.corp_vault;
create policy cv_sel on public.corp_vault
  for select to authenticated
  using (public.is_corp_member(corp_vault.corp_id, auth.uid()));

-- WRITE stays exactly as narrow as it was: you may only insert/update/delete
-- your OWN deposit rows. Everything a member does to somebody else's row goes
-- through corp_vault_withdraw below, which is the whole point of this file.
drop policy if exists cv_ins on public.corp_vault;
create policy cv_ins on public.corp_vault
  for insert to authenticated
  with check (depositor_id = auth.uid() and public.is_corp_member(corp_vault.corp_id, auth.uid()));

drop policy if exists cv_upd on public.corp_vault;
create policy cv_upd on public.corp_vault
  for update to authenticated
  using (depositor_id = auth.uid())
  with check (depositor_id = auth.uid());

drop policy if exists cv_del on public.corp_vault;
create policy cv_del on public.corp_vault
  for delete to authenticated
  using (depositor_id = auth.uid()
         or exists (select 1 from public.corporations c
                     where c.id = corp_vault.corp_id and c.founder_id = auth.uid()));


-- ── 3b. 🔴 TRUNCATE — THE HOLE RLS CANNOT SEE ───────────────────────────────
-- Found live on 2026-08-21: `authenticated` and `anon` hold TRUNCATE on both
-- corp_vault and corp_vault_log, from Supabase's default
-- `grant all on all tables in schema public`. **RLS DOES NOT APPLY TO TRUNCATE.**
-- Every policy above is written and reviewed and correct, and any signed-in
-- player could still have run `truncate public.corp_vault` and destroyed every
-- corporation's vault in the game — and then `truncate public.corp_vault_log`
-- to erase the evidence, because the log is append-only against INSERT/UPDATE/
-- DELETE and says nothing about TRUNCATE.
-- Nothing in the app truncates anything; these grants have never been used.
--
-- TRIGGER and REFERENCES go too, on the same tables and for the same reason:
-- neither is used by the client, and TRIGGER lets a role attach code to a table
-- it can only otherwise read through a policy.
revoke truncate, trigger, references on public.corp_vault     from anon, authenticated;
revoke truncate, trigger, references on public.corp_vault_log from anon, authenticated;

-- anon is not a corporation member and never will be. Its write grants are dead
-- (no policy names `anon`), so removing them changes no behaviour — it removes
-- the second thing that would have to go wrong.
revoke insert, update, delete on public.corp_vault from anon;

-- ⚠ corp_members carries the SAME default TRUNCATE grant, and truncating it
--   would dissolve every corporation in the game. It is not re-issued here
--   because that table belongs to the roster work; it needs the identical two
--   lines in whichever migration owns it:
--     revoke truncate, trigger, references on public.corp_members from anon, authenticated;


-- ── 4. DEPOSIT ──────────────────────────────────────────────────────────────
-- Moves goods IN and appends the ledger row in one transaction. The client can
-- still fall back to a direct upsert when this function is absent (see
-- index.html, JB_action 'vaultDeposit') — that path moves the goods but writes
-- no ledger line, which is exactly why this function exists.
--
-- Returns the depositor's new stack size, so the caller can see what happened
-- instead of trusting a silent success.
drop function if exists public.corp_vault_deposit(uuid, text, text, text, text, numeric, text);
create function public.corp_vault_deposit(
  p_corp_id    uuid,
  p_kind       text,
  p_item_id    text,
  p_name       text,
  p_icon       text,
  p_qty        numeric,
  p_actor_name text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_qty numeric;
  v_new numeric;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_corp_id is null or coalesce(btrim(p_item_id), '') = '' then
    raise exception 'corporation and item are required';
  end if;
  -- Only the three kinds the game can hand back on withdrawal. A fourth kind
  -- would be depositable and then permanently stuck, because index.html has
  -- nowhere to credit it to.
  if p_kind is null or p_kind not in ('card', 'item', 'resource') then
    raise exception 'unknown vault kind: %', coalesce(p_kind, 'null');
  end if;
  v_qty := floor(coalesce(p_qty, 0));
  if v_qty <= 0 then raise exception 'quantity must be a positive whole number'; end if;
  if not public.is_corp_member(p_corp_id, v_uid) then
    raise exception 'not a member of that organization';
  end if;

  insert into corp_vault (corp_id, depositor_id, depositor_name, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty)
  on conflict (corp_id, depositor_id, kind, item_id)
    do update set qty        = corp_vault.qty + excluded.qty,
                  name       = coalesce(nullif(excluded.name, ''), corp_vault.name),
                  icon       = coalesce(nullif(excluded.icon, ''), corp_vault.icon),
                  depositor_name = coalesce(nullif(excluded.depositor_name, ''), corp_vault.depositor_name),
                  updated_at = now()
  returning qty into v_new;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'deposit', p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty);

  return v_new;
end $$;


-- ── 5. WITHDRAW — any member, oldest deposits first ─────────────────────────
-- The vault is keyed per depositor, so one withdrawal usually spans several
-- rows. Oldest-first is fair and predictable, and the whole thing is one
-- transaction: either the full amount comes out and is logged, or nothing moves.
--
-- Returns the quantity actually taken. index.html credits THAT number to the
-- player, never the number it asked for — a client that assumes the two agree is
-- one server-side clamp away from minting items out of nothing.
drop function if exists public.corp_vault_withdraw(uuid, text, text, numeric, text);
drop function if exists public.corp_vault_withdraw(uuid, text, text, numeric, text, text, text);
create function public.corp_vault_withdraw(
  p_corp_id    uuid,
  p_kind       text,
  p_item_id    text,
  p_qty        numeric,
  p_actor_name text default null,
  p_name       text default null,
  p_icon       text default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_want  numeric;
  v_left  numeric;
  v_avail numeric;
  v_name  text;
  v_icon  text;
  r       record;
  v_take  numeric;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_corp_id is null or coalesce(btrim(p_item_id), '') = '' then
    raise exception 'corporation and item are required';
  end if;
  if p_kind is null or p_kind not in ('card', 'item', 'resource') then
    raise exception 'unknown vault kind: %', coalesce(p_kind, 'null');
  end if;
  v_want := floor(coalesce(p_qty, 0));
  if v_want <= 0 then raise exception 'quantity must be a positive whole number'; end if;
  v_left := v_want;
  if not public.is_corp_member(p_corp_id, v_uid) then
    raise exception 'not a member of that organization';
  end if;

  -- 🔒 LOCK FIRST, MEASURE SECOND. Measuring before locking lets two concurrent
  -- withdrawals both pass the "enough available" test and, between them, take
  -- more than the vault holds. Every row for this item is locked for the rest of
  -- the transaction, so the sum below cannot move under us.
  perform 1 from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id
   for update;

  select coalesce(sum(qty), 0), max(name), max(icon)
    into v_avail, v_name, v_icon
    from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id;

  if v_avail < v_want then
    raise exception 'the vault holds only % of %', v_avail, coalesce(v_name, p_item_id);
  end if;

  for r in select id, qty from corp_vault
            where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty > 0
            order by created_at asc, id asc
  loop
    exit when v_left <= 0;
    v_take := least(r.qty, v_left);
    update corp_vault set qty = qty - v_take, updated_at = now() where id = r.id;
    v_left := v_left - v_take;
  end loop;

  -- An emptied stack is deleted, not left at 0 — a 0-qty row is a stack the
  -- Vault screen would have to filter out on every render forever.
  delete from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty <= 0;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'withdraw', p_kind, p_item_id,
          left(coalesce(p_name, v_name, p_item_id), 80),
          left(coalesce(p_icon, v_icon, ''), 12),
          v_want - v_left);

  return v_want - v_left;
end $$;


-- ── 6. GRANTS ───────────────────────────────────────────────────────────────
revoke all on function public.corp_vault_deposit(uuid, text, text, text, text, numeric, text) from public, anon;
revoke all on function public.corp_vault_withdraw(uuid, text, text, numeric, text, text, text) from public, anon;
grant execute on function public.corp_vault_deposit(uuid, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.corp_vault_withdraw(uuid, text, text, numeric, text, text, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   log_table        = corp_vault_log
--   fns              = 3   (is_corp_member, corp_vault_deposit, corp_vault_withdraw)
--   log_policies     = 1   and it is a SELECT — no write policy exists
--   log_writes_held  = 0   no INSERT/UPDATE/DELETE grant to authenticated/anon
--   truncate_held    = 0   ← the one that was NOT 0 before this file
--   vault_unique_key = 1   the ON CONFLICT target the deposit function needs
-- ════════════════════════════════════════════════════════════════════════════
select
  to_regclass('public.corp_vault_log')::text as log_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_corp_member','corp_vault_deposit','corp_vault_withdraw')) as fns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'corp_vault_log') as log_policies,
  (select string_agg(cmd, ',') from pg_policies where schemaname = 'public' and tablename = 'corp_vault_log') as log_policy_cmds,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'corp_vault_log'
      and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE')) as log_writes_held,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('corp_vault','corp_vault_log')
      and grantee in ('anon','authenticated')
      and privilege_type = 'TRUNCATE') as truncate_held,
  (select count(*) from pg_index i join pg_class t on t.oid = i.indrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'corp_vault' and i.indisunique
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(i.indkey) k
             join pg_attribute a on a.attrelid = t.oid and a.attnum = k)
          = array['corp_id','depositor_id','item_id','kind']) as vault_unique_key;

-- ── A second, manual check that matters more than any of the above ──────────
-- As a member who did NOT deposit the item, in the SQL editor with a member's
-- JWT (or from the app), the withdrawal must move the vault and write the log:
--
--   select qty from public.corp_vault
--    where corp_id = '<corp>' and kind='resource' and item_id='<item>';   -- before
--   select public.corp_vault_withdraw('<corp>','resource','<item>', 5, 'Tester');
--   select qty from public.corp_vault
--    where corp_id = '<corp>' and kind='resource' and item_id='<item>';   -- 5 fewer
--   select action, qty, actor_name from public.corp_vault_log
--    where corp_id = '<corp>' order by created_at desc limit 1;           -- withdraw, 5
--
-- And the refusal, from an account in NO corporation — expect an exception,
-- never a row:
--   select public.corp_vault_withdraw('<corp>','resource','<item>', 1);
