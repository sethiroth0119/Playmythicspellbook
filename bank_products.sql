-- ═══════════════════════════════════════════════════════════════════════════
-- 🏦 BANK BACK OFFICE — loan products + bank identity
-- ---------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL editor, AFTER player_banks.sql (and after
-- bank_cinder_charter.sql). Adds one table and three columns. Safe to re-run.
--
-- A PRODUCT is a standing offer on a bank's rate board. Borrowers apply
-- against it, so its terms decide who can borrow and what the bank may seize.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Identity: the sigil + motto shown in the Registry of Player Banks ──────
-- ⚠ No prestige column here: player_banks already has `prestige`, and that is
-- what bank_directory() selects. Adding a second `prestige_score` would leave
-- two columns meaning the same thing with only one of them ever written to.
alter table public.player_banks add column if not exists motto     text default '';
alter table public.player_banks add column if not exists logo_url  text;

-- ── Loan products ─────────────────────────────────────────────────────────
create table if not exists public.bank_products (
  id           bigserial primary key,
  bank_id      uuid not null references public.player_banks(owner_id) on delete cascade,
  name         text not null,
  currency     text not null default 'cinder' check (currency in ('cinder','aza','myth')),
  min_amount   bigint not null default 0 check (min_amount >= 0),
  max_amount   bigint not null default 0 check (max_amount >= 0),
  rate_weekly  numeric not null default 4 check (rate_weekly >= 0),
  term_days    int    not null default 7 check (term_days between 1 and 90),
  structure    text   not null default 'lump' check (structure in ('lump','installment')),
  -- Which collateral classes this product accepts: {business,vehicle,realestate,cards}
  classes      jsonb  not null default '{}'::jsonb,
  min_ember    int    not null default 0 check (min_ember between 0 and 1000),
  max_active   int    not null default 2 check (max_active between 0 and 5),
  note         text   default '',
  is_live      boolean not null default true,
  taken        int    not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (max_amount >= min_amount)
);
create index if not exists bank_products_bank_idx on public.bank_products(bank_id, is_live);

alter table public.bank_products enable row level security;

-- Products are a PUBLIC rate board — a borrower has to be able to read the
-- offer before applying. Only the bank's owner may create or change one.
drop policy if exists bp_read on public.bank_products;
create policy bp_read on public.bank_products for select using (true);

drop policy if exists bp_owner_write on public.bank_products;
create policy bp_owner_write on public.bank_products for all
  using  (exists (select 1 from public.player_banks b where b.owner_id = bank_products.bank_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.player_banks b where b.owner_id = bank_products.bank_id and b.owner_id = auth.uid()));

-- ── Save the bank's own identity (name / motto / sigil) ───────────────────
-- A plain UPDATE would work under pb_own_update, but routing it through an RPC
-- keeps the length caps server-side rather than trusting the client's maxlength.
create or replace function public.bank_save_identity(
  p_name text, p_motto text default '', p_logo_url text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  update public.player_banks set
    bank_name = coalesce(nullif(btrim(p_name), ''), bank_name),
    motto     = left(coalesce(p_motto, ''), 80),
    -- ⚠ Only replace the sigil when one is actually supplied. Passing null must
    -- LEAVE the existing sigil alone, or every name edit would wipe the logo.
    logo_url  = coalesce(p_logo_url, logo_url),
    updated_at = now()
  where owner_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_bank'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Clear the sigil (explicit, since bank_save_identity ignores nulls) ────
create or replace function public.bank_clear_logo()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  update public.player_banks set logo_url = null, updated_at = now() where owner_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ── Directory now carries identity + product count ───────────────────────
-- ⚠ DROP first. bank_directory() already exists with a narrower RETURNS TABLE,
-- and `create or replace` cannot change a function's output row type — Postgres
-- rejects it with 42P13 "cannot change return type of existing function".
-- Dropping and recreating inside the same transaction means no window where the
-- client's rpc('bank_directory') call would 404.
drop function if exists public.bank_directory();
create function public.bank_directory()
returns table (owner_id uuid, owner_name text, bank_name text, tagline text, motto text,
               logo_url text, charter_tier int, mt_staked numeric, deposits bigint,
               loans_serviced int, defaults_taken int, prestige int, products int)
language sql security definer set search_path = public as $$
  select b.owner_id, b.owner_name, b.bank_name, b.tagline, b.motto, b.logo_url,
         b.charter_tier, b.mt_staked, b.deposits, b.loans_serviced, b.defaults_taken, b.prestige,
         (select count(*)::int from public.bank_products p where p.bank_id = b.owner_id and p.is_live)
    from public.player_banks b
   where b.is_open
   order by b.charter_tier desc, b.mt_staked desc, b.loans_serviced desc
   limit 100;
$$;

grant execute on function public.bank_save_identity(text, text, text) to authenticated;
grant execute on function public.bank_clear_logo() to authenticated;
grant execute on function public.bank_directory() to anon, authenticated;

-- VERIFY
--   select * from public.bank_directory();
--   insert into public.bank_products (bank_id, name, currency, min_amount, max_amount)
--     values (auth.uid(), 'Test Line', 'cinder', 5000, 40000);
--   select id, name, currency, is_live from public.bank_products where bank_id = auth.uid();
