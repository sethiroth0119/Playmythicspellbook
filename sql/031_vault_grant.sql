-- ===========================================================================
-- 031 — MANUAL VAULT-ROW GRANTS, FOR PLAYERS WHOSE PAID CONTAINERS WERE WIPED.
--
-- WHY THIS EXISTS
-- The one-time gear clean (_gearResetOnce, index.html) did
-- `Profile.vaultLayout = {}`, which threw away the whole object. That object
-- holds two unrelated things: `placements` (the ITEMS in the vault — gear, and
-- correct to clear) and `rows`/`cols`/`stashExtra` (the SIZE of the vault,
-- bought with Ⓐ Aza at 25 / 60 / 120 a container). So a "gear clean" silently
-- repossessed paid capacity. Worse, the clean's only durable latch was
-- device-local storage, so it re-fired on a new device or after a storage
-- eviction. Both are fixed client-side; this file is the RESTITUTION path.
--
-- ⚠ THE PURCHASES WERE NEVER LEDGERED. wallet_ledger begins 2026-08-10 and has
--   no vault/crate/container rows at all, so there is NO record of who bought
--   what. Nothing here can compute the right number — it can only apply one a
--   human decided, from a player report. That is the whole design brief.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT AN RLS POLICY
-- 029 widened economy_nodes UPDATE to admins and said, correctly, that RLS
-- gates ROWS and not JSONB KEYS. The same move here would be far worse:
-- user_profiles also carries `gems` and `sovereigns`, so an admin UPDATE policy
-- on that table would hand every admin session blanket write access to the
-- real-money balances of every account, to fix a vault. 029 named the correct
-- alternative for exactly this case — "if per-key control is ever wanted it
-- needs a SECURITY DEFINER setter, not a policy" — so that is what this is.
-- It touches ONE key, forge.__vaultLayout__.rows, and can express nothing else.
--
-- ⚠ NEVER PAY TWICE. Grants are driven by support tickets, and a support ticket
--   gets actioned twice — the same pattern the offline catch-up documents. Every
--   grant carries a caller-supplied `p_ref`; a repeat of a ref already in the
--   log is a NO-OP that returns the original result. Re-running a grant is
--   therefore safe, which matters when the alternative is a second free Relic
--   Vault Door.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ── 1. THE AUDIT LOG ───────────────────────────────────────────────────────
-- Append-only, per CLAUDE.md. This is the record that a grant happened and who
-- authorised it; it is the only trace, since the original purchases have none.
create table if not exists public.vault_grant_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rows_added  integer not null,
  rows_before integer not null,
  rows_after  integer not null,
  reason      text not null default '',
  ref         text not null,
  granted_by  uuid,
  created_at  timestamptz not null default now()
);

-- The idempotency key. UNIQUE is what makes "never pay twice" true under
-- concurrency, not the SELECT in the function body.
create unique index if not exists vault_grant_log_ref_uidx
  on public.vault_grant_log (ref);
create index if not exists vault_grant_log_user_idx
  on public.vault_grant_log (user_id, created_at desc);

alter table public.vault_grant_log enable row level security;

-- Admins see everything. A player may read their OWN grants — they were told
-- "we restored your vault", and being able to see that record is the point.
-- No INSERT/UPDATE/DELETE policy for anyone: the log is written ONLY by the
-- SECURITY DEFINER function below, which bypasses RLS. Append-only by
-- construction rather than by convention.
drop policy if exists vgl_sel on public.vault_grant_log;
create policy vgl_sel on public.vault_grant_log
  for select using (public.is_admin() or user_id = auth.uid());

-- ── 2. THE GRANT ───────────────────────────────────────────────────────────
-- Adds rows to a player's vault. Returns one row describing what happened, so
-- the caller can SEE the result instead of trusting a silent success — the
-- silent-no-op trap this codebase has hit three times (gifts, bank_of_ethos,
-- economy_nodes).
drop function if exists public.admin_grant_vault_rows(uuid, integer, text, text);
create or replace function public.admin_grant_vault_rows(
  p_user_id uuid,
  p_rows    integer,
  p_reason  text default '',
  p_ref     text default null
)
returns table (applied boolean, rows_before integer, rows_after integer, note text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref    text;
  v_forge  jsonb;
  v_vault  jsonb;
  v_before integer;
  v_after  integer;
  v_prev   public.vault_grant_log%rowtype;
  -- Mirrors the client: VAULT_COLS = 10, VAULT_ROWS = 8, VAULT_MAX_ROWS = 72.
  -- ⚠ If those change in index.html they must change here too, or the grant
  --   will hand out a vault the client refuses to draw.
  c_base_rows constant integer := 8;
  c_base_cols constant integer := 10;
  c_max_rows  constant integer := 72;
begin
  if not public.is_admin() then
    raise exception 'admin_grant_vault_rows: admin only';
  end if;
  if p_user_id is null then
    raise exception 'admin_grant_vault_rows: p_user_id is required';
  end if;
  if p_rows is null or p_rows <= 0 then
    raise exception 'admin_grant_vault_rows: p_rows must be a positive integer';
  end if;

  -- A missing ref is derived, not allowed to be null: an un-keyed grant could
  -- not be de-duplicated, which is the one guarantee this function sells.
  v_ref := coalesce(nullif(btrim(p_ref), ''), 'auto:' || p_user_id::text || ':' || p_rows::text || ':' || btrim(coalesce(p_reason, '')));

  select * into v_prev from public.vault_grant_log where ref = v_ref;
  if found then
    return query select false, v_prev.rows_before, v_prev.rows_after,
      ('already applied ' || to_char(v_prev.created_at, 'YYYY-MM-DD HH24:MI') || ' — no change')::text;
    return;
  end if;

  -- Lock the profile row so two concurrent grants cannot both read the same
  -- "before" and each write their own "after", losing one of the two.
  select coalesce(forge, '{}'::jsonb) into v_forge
    from public.user_profiles where user_id = p_user_id for update;
  if not found then
    raise exception 'admin_grant_vault_rows: no user_profiles row for %', p_user_id;
  end if;

  v_vault := coalesce(v_forge -> '__vaultLayout__', '{}'::jsonb);
  if jsonb_typeof(v_vault) <> 'object' then
    v_vault := '{}'::jsonb;
  end if;

  -- An absent `rows` means the default vault — which is exactly the state the
  -- wipe leaves behind, and also the state of a player who never opened theirs.
  -- Both correctly start from the base 8.
  v_before := coalesce((v_vault ->> 'rows')::integer, c_base_rows);
  v_after  := least(c_max_rows, v_before + p_rows);

  if v_after = v_before then
    return query select false, v_before, v_after,
      ('already at the maximum of ' || c_max_rows || ' rows — nothing granted')::text;
    return;
  end if;

  v_vault := v_vault
    || jsonb_build_object('rows', v_after)
    || jsonb_build_object('cols', coalesce((v_vault ->> 'cols')::integer, c_base_cols));
  -- Never invent contents. If the player has no placements array, give them an
  -- empty one; if they DO have one, it is untouched.
  if not (v_vault ? 'placements') then
    v_vault := v_vault || jsonb_build_object('placements', '[]'::jsonb);
  end if;

  update public.user_profiles
     set forge = coalesce(forge, '{}'::jsonb) || jsonb_build_object('__vaultLayout__', v_vault),
         updated_at = now()
   where user_id = p_user_id;

  insert into public.vault_grant_log (user_id, rows_added, rows_before, rows_after, reason, ref, granted_by)
  values (p_user_id, v_after - v_before, v_before, v_after, coalesce(p_reason, ''), v_ref, auth.uid());

  return query select true, v_before, v_after,
    ('granted ' || (v_after - v_before) || ' row(s)')::text;
end;
$$;

revoke all on function public.admin_grant_vault_rows(uuid, integer, text, text) from public, anon;
grant execute on function public.admin_grant_vault_rows(uuid, integer, text, text) to authenticated;

-- ── 3. A LOOKUP, so a report can be turned into a user_id ──────────────────
-- Read-only and admin-gated. Support gets a handle or a display name, never a
-- uuid; without this the grant is unusable without direct table access.
drop function if exists public.admin_find_vault(text);
create or replace function public.admin_find_vault(p_query text)
returns table (user_id uuid, display_name text, vault_rows integer, vault_cols integer, stash_extra integer, items integer, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.user_id,
         p.display_name,
         coalesce((p.forge -> '__vaultLayout__' ->> 'rows')::integer, 8),
         coalesce((p.forge -> '__vaultLayout__' ->> 'cols')::integer, 10),
         coalesce((p.forge -> '__vaultLayout__' ->> 'stashExtra')::integer, 0),
         coalesce(jsonb_array_length(p.forge -> '__vaultLayout__' -> 'placements'), 0),
         p.updated_at
    from public.user_profiles p
   where public.is_admin()
     and (p.user_id::text = btrim(p_query)
          or p.display_name ilike '%' || btrim(p_query) || '%')
   order by p.updated_at desc
   limit 25;
$$;

revoke all on function public.admin_find_vault(text) from public, anon;
grant execute on function public.admin_find_vault(text) to authenticated;

-- ===========================================================================
-- VERIFY
--
-- 0) Objects exist:
--
-- select to_regclass('public.vault_grant_log') as log_table,
--        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--          where n.nspname='public' and p.proname in ('admin_grant_vault_rows','admin_find_vault')) as fns;
-- -> log_table not null, fns = 2
--
-- 1) Find the player from their report:
--
-- select * from public.admin_find_vault('SomeDisplayName');
--
-- 2) Grant. `p_ref` should be the support ticket / report id — anything stable
--    and unique to THAT decision:
--
-- select * from public.admin_grant_vault_rows(
--   '<user_id>'::uuid, 5, 'Relic Vault Door lost to the 2026-07-29 gear clean', 'ticket-1234');
-- -> applied = true, rows_before = 8, rows_after = 13
--
-- 3) Re-run the EXACT same statement. This is the important one:
-- -> applied = false, note = 'already applied … — no change'
--    and rows_after is unchanged. No second grant.
--
-- 4) A non-admin must be refused entirely:
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<any user_id>","role":"authenticated","email":"nobody@example.com"}';
--   select * from public.admin_grant_vault_rows('<user_id>'::uuid, 5, 'nope', 'attack-1');
--   -> expect: ERROR admin_grant_vault_rows: admin only
-- rollback;
--
-- 5) The audit trail, and what a player can see of it:
--
-- select * from public.vault_grant_log order by created_at desc limit 20;
-- ===========================================================================
