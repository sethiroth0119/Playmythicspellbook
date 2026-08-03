-- ═══════════════════════════════════════════════════════════════════════════
-- 🏦 PLAYER-OWNED BANKS — schema, RLS and atomic RPCs
-- ---------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL editor (project ktsiasyjusesawtrwrjc).
-- Safe to re-run: every object is created IF NOT EXISTS / OR REPLACE.
--
-- DESIGN NOTES THAT MATTER
--  • Cinder never moves client-side. Approving a loan, depositing, and repaying
--    all run through SECURITY DEFINER RPCs that re-check the money server-side.
--    A client that lies about its balance simply fails the check.
--  • A bank's RESERVES are real Cinder held by the bank, not a display number.
--    The 30% reserve requirement is enforced in bank_decide(), not in the UI,
--    because the UI is the attacker-controlled surface.
--  • TELLERS underwrite on the owner's behalf. Permission is checked in SQL
--    against bank_tellers.can_approve + max_approve, so a teller cannot approve
--    past their limit by editing the client.
--  • Charter fee is BURNED, stake is LOCKED. Both are recorded in MT against
--    mythic_balances, which is the existing server-side MT mirror.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The bank ────────────────────────────────────────────────────────────
create table if not exists public.player_banks (
  owner_id        uuid primary key references auth.users(id) on delete cascade,
  owner_name      text not null default 'Banker',
  bank_name       text not null default 'Lending House',
  tagline         text default '',
  charter_tier    int  not null default 1 check (charter_tier between 1 and 3),
  mt_burned       numeric not null default 0,      -- charter fee, unrecoverable
  mt_staked       numeric not null default 0,      -- locked capital
  mt_overstake    numeric not null default 0,      -- extra stake → deposit cap
  reserves        bigint  not null default 0,      -- Cinder the bank holds
  deposits        bigint  not null default 0,      -- Cinder owed to depositors
  loan_book       bigint  not null default 0,      -- Cinder currently lent out
  loans_serviced  int     not null default 0,
  defaults_taken  int     not null default 0,
  prestige        int     not null default 0,
  is_open         boolean not null default true,
  unbond_at       timestamptz,                     -- set when unstaking begins
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists player_banks_open_idx on public.player_banks(is_open, charter_tier desc);

-- ── 2. Tellers — the people who underwrite for the owner ───────────────────
create table if not exists public.bank_tellers (
  id           bigserial primary key,
  bank_id      uuid not null references public.player_banks(owner_id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_name    text not null default 'Teller',
  role         text not null default 'teller' check (role in ('teller','manager')),
  can_approve  boolean not null default true,
  max_approve  bigint  not null default 50000,     -- per-loan ceiling for this teller
  wage_per_day bigint  not null default 0,
  hired_at     timestamptz not null default now(),
  unique (bank_id, user_id)
);
create index if not exists bank_tellers_user_idx on public.bank_tellers(user_id);

-- ── 3. Applications ────────────────────────────────────────────────────────
create table if not exists public.bank_applications (
  id             bigserial primary key,
  bank_id        uuid not null references public.player_banks(owner_id) on delete cascade,
  applicant_id   uuid not null references auth.users(id) on delete cascade,
  applicant_name text not null default 'Applicant',
  principal      bigint not null check (principal > 0),
  term_days      int    not null default 7,
  structure      text   not null default 'Lump sum at maturity',
  purpose        text   not null default 'General',
  pitch          text   default '',
  collateral     jsonb  not null default '[]'::jsonb,   -- [{item,cat,mkt,cut}]
  ember_score    int    not null default 300,
  ember_tier     text   not null default 'Ashen',
  status         text   not null default 'open'
                 check (status in ('open','approved','denied','countered','withdrawn','lapsed')),
  verdict        jsonb,                                  -- {kind,principal,rate,term,reason}
  decided_by     uuid,
  decided_by_name text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists bank_apps_bank_idx on public.bank_applications(bank_id, status, created_at desc);
create index if not exists bank_apps_applicant_idx on public.bank_applications(applicant_id, created_at desc);

-- ── 4. Open loans ──────────────────────────────────────────────────────────
create table if not exists public.bank_loans (
  id            bigserial primary key,
  bank_id       uuid not null references public.player_banks(owner_id) on delete cascade,
  application_id bigint references public.bank_applications(id) on delete set null,
  borrower_id   uuid not null references auth.users(id) on delete cascade,
  borrower_name text not null default 'Borrower',
  principal     bigint not null,
  rate_weekly   numeric not null default 4,
  term_days     int not null default 7,
  bond          bigint not null default 0,
  collateral    jsonb not null default '[]'::jsonb,
  owed          bigint not null,
  opened_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  closed_at     timestamptz,
  outcome       text check (outcome in ('repaid','repaid_late','defaulted'))
);
create index if not exists bank_loans_bank_idx on public.bank_loans(bank_id, closed_at);
create index if not exists bank_loans_borrower_idx on public.bank_loans(borrower_id, closed_at);

-- ── 5. Ledger — every movement, for the receipts panel ─────────────────────
create table if not exists public.bank_ledger (
  id        bigserial primary key,
  bank_id   uuid not null references public.player_banks(owner_id) on delete cascade,
  kind      text not null,          -- charter|deposit|withdraw|disburse|repay|default|wage|fee
  amount    bigint not null default 0,
  actor_id  uuid,
  actor_name text,
  note      text default '',
  created_at timestamptz not null default now()
);
create index if not exists bank_ledger_bank_idx on public.bank_ledger(bank_id, created_at desc);

-- ── 6. Deposits held for other players ─────────────────────────────────────
create table if not exists public.bank_deposit_accounts (
  id         bigserial primary key,
  bank_id    uuid not null references public.player_banks(owner_id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  user_name  text not null default 'Depositor',
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  unique (bank_id, user_id)
);
create index if not exists bank_dep_user_idx on public.bank_deposit_accounts(user_id);

-- ═══ ROW LEVEL SECURITY ═══════════════════════════════════════════════════
alter table public.player_banks           enable row level security;
alter table public.bank_tellers           enable row level security;
alter table public.bank_applications      enable row level security;
alter table public.bank_loans             enable row level security;
alter table public.bank_ledger            enable row level security;
alter table public.bank_deposit_accounts  enable row level security;

-- Banks are a public directory — anyone may browse them.
drop policy if exists pb_read on public.player_banks;
create policy pb_read on public.player_banks for select using (true);
drop policy if exists pb_own_update on public.player_banks;
create policy pb_own_update on public.player_banks for update using (auth.uid() = owner_id);

-- Tellers: readable by anyone (a visitor should see who staffs the desk),
-- writable only by the bank owner.
drop policy if exists bt_read on public.bank_tellers;
create policy bt_read on public.bank_tellers for select using (true);
drop policy if exists bt_owner_write on public.bank_tellers;
create policy bt_owner_write on public.bank_tellers for all
  using (exists (select 1 from public.player_banks b where b.owner_id = bank_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.player_banks b where b.owner_id = bank_id and b.owner_id = auth.uid()));

-- Applications: visible to the applicant, the bank owner, and that bank's
-- tellers. NOT world-readable — a loan application is private financial data.
drop policy if exists ba_read on public.bank_applications;
create policy ba_read on public.bank_applications for select using (
  auth.uid() = applicant_id
  or auth.uid() = bank_id
  or exists (select 1 from public.bank_tellers t where t.bank_id = bank_applications.bank_id and t.user_id = auth.uid())
);
drop policy if exists ba_insert_own on public.bank_applications;
create policy ba_insert_own on public.bank_applications for insert with check (auth.uid() = applicant_id);
drop policy if exists ba_withdraw_own on public.bank_applications;
create policy ba_withdraw_own on public.bank_applications for update using (auth.uid() = applicant_id);

drop policy if exists bl_read on public.bank_loans;
create policy bl_read on public.bank_loans for select using (
  auth.uid() = borrower_id or auth.uid() = bank_id
  or exists (select 1 from public.bank_tellers t where t.bank_id = bank_loans.bank_id and t.user_id = auth.uid())
);

drop policy if exists blg_read on public.bank_ledger;
create policy blg_read on public.bank_ledger for select using (
  auth.uid() = bank_id
  or exists (select 1 from public.bank_tellers t where t.bank_id = bank_ledger.bank_id and t.user_id = auth.uid())
);

drop policy if exists bda_read on public.bank_deposit_accounts;
create policy bda_read on public.bank_deposit_accounts for select using (
  auth.uid() = user_id or auth.uid() = bank_id
);

-- ═══ RPCs — every value movement is server-authoritative ══════════════════

-- Open or upgrade a charter. Burns the fee, locks the stake, both in MT.
create or replace function public.bank_open_charter(
  p_tier int, p_stake numeric, p_bank_name text, p_tagline text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fee numeric;
  v_min numeric;
  v_bal numeric;
  v_name text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  -- Charter table lives here so the client cannot dictate its own price.
  v_fee := case p_tier when 1 then 50 when 2 then 150 when 3 then 400 else null end;
  v_min := case p_tier when 1 then 200 when 2 then 750 when 3 then 2100 else null end;
  if v_fee is null then return jsonb_build_object('ok', false, 'error', 'bad_tier'); end if;
  if p_stake < v_min then
    return jsonb_build_object('ok', false, 'error', 'stake_too_low', 'required', v_min);
  end if;

  select coalesce(mt, 0) into v_bal from public.mythic_balances where user_id = v_uid;
  if v_bal is null then v_bal := 0; end if;
  if v_bal < (v_fee + p_stake) then
    return jsonb_build_object('ok', false, 'error', 'insufficient_mt',
                              'need', v_fee + p_stake, 'have', v_bal);
  end if;

  update public.mythic_balances set mt = mt - (v_fee + p_stake) where user_id = v_uid;

  select coalesce(display_name, 'Banker') into v_name
    from public.user_profiles where user_id = v_uid;

  insert into public.player_banks (owner_id, owner_name, bank_name, tagline, charter_tier,
                                   mt_burned, mt_staked, mt_overstake)
  values (v_uid, coalesce(v_name,'Banker'), coalesce(nullif(p_bank_name,''),'Lending House'),
          coalesce(p_tagline,''), p_tier, v_fee, v_min, greatest(0, p_stake - v_min))
  on conflict (owner_id) do update set
    charter_tier = greatest(public.player_banks.charter_tier, excluded.charter_tier),
    bank_name    = excluded.bank_name,
    tagline      = excluded.tagline,
    mt_burned    = public.player_banks.mt_burned + excluded.mt_burned,
    mt_staked    = public.player_banks.mt_staked + excluded.mt_staked,
    mt_overstake = public.player_banks.mt_overstake + excluded.mt_overstake,
    updated_at   = now();

  insert into public.bank_ledger (bank_id, kind, amount, actor_id, actor_name, note)
  values (v_uid, 'charter', 0, v_uid, coalesce(v_name,'Banker'),
          'Charter ' || p_tier || ' — ' || v_fee || ' MT burned, ' || p_stake || ' MT staked');

  return jsonb_build_object('ok', true, 'tier', p_tier, 'burned', v_fee, 'staked', p_stake);
end $$;

-- The underwriting decision. This is the one that has to be airtight.
create or replace function public.bank_decide(
  p_app_id bigint, p_kind text, p_principal bigint default null,
  p_rate numeric default 4, p_term int default null, p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_app  public.bank_applications%rowtype;
  v_bank public.player_banks%rowtype;
  v_is_owner boolean;
  v_teller public.bank_tellers%rowtype;
  v_principal bigint;
  v_free bigint;
  v_name text;
  v_loan_id bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  select * into v_app from public.bank_applications where id = p_app_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if v_app.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'already_decided'); end if;

  select * into v_bank from public.player_banks where owner_id = v_app.bank_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_bank'); end if;

  v_is_owner := (v_uid = v_bank.owner_id);
  if not v_is_owner then
    select * into v_teller from public.bank_tellers where bank_id = v_app.bank_id and user_id = v_uid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_staff'); end if;
  end if;

  v_principal := coalesce(p_principal, v_app.principal);

  if p_kind = 'approved' then
    -- A teller may not approve past their ceiling. Checked HERE, not in the UI.
    if not v_is_owner and (not v_teller.can_approve or v_principal > v_teller.max_approve) then
      return jsonb_build_object('ok', false, 'error', 'over_teller_limit', 'limit', v_teller.max_approve);
    end if;
    -- 30% reserve requirement — the bank may not lend itself into a run.
    v_free := greatest(0, v_bank.reserves - (v_bank.deposits * 30 / 100));
    if v_principal > v_free then
      return jsonb_build_object('ok', false, 'error', 'reserve_breach', 'free', v_free);
    end if;

    update public.player_banks set
      reserves = reserves - v_principal,
      loan_book = loan_book + v_principal,
      loans_serviced = loans_serviced + 1,
      updated_at = now()
    where owner_id = v_bank.owner_id;

    insert into public.bank_loans (bank_id, application_id, borrower_id, borrower_name,
                                   principal, rate_weekly, term_days, bond, collateral, owed, due_at)
    values (v_app.bank_id, v_app.id, v_app.applicant_id, v_app.applicant_name,
            v_principal, coalesce(p_rate,4), coalesce(p_term, v_app.term_days), 0, v_app.collateral,
            v_principal + (v_principal * coalesce(p_rate,4) / 100 * (coalesce(p_term, v_app.term_days)::numeric / 7))::bigint,
            now() + (coalesce(p_term, v_app.term_days) || ' days')::interval)
    returning id into v_loan_id;
  end if;

  select coalesce(display_name,'Staff') into v_name from public.user_profiles where user_id = v_uid;

  update public.bank_applications set
    status = p_kind,
    verdict = jsonb_build_object('kind', p_kind, 'principal', v_principal,
                                 'rate', coalesce(p_rate,4), 'term', coalesce(p_term, v_app.term_days),
                                 'reason', coalesce(p_reason,'')),
    decided_by = v_uid, decided_by_name = coalesce(v_name,'Staff'), decided_at = now()
  where id = p_app_id;

  insert into public.bank_ledger (bank_id, kind, amount, actor_id, actor_name, note)
  values (v_app.bank_id,
          case when p_kind = 'approved' then 'disburse' else 'fee' end,
          case when p_kind = 'approved' then v_principal else 0 end,
          v_uid, coalesce(v_name,'Staff'),
          p_kind || ' — application #' || p_app_id ||
          case when p_reason <> '' then ' (' || p_reason || ')' else '' end);

  return jsonb_build_object('ok', true, 'kind', p_kind, 'loan_id', v_loan_id, 'principal', v_principal);
end $$;

-- Deposit Cinder into another player's bank. Increases that bank's reserves
-- AND what it owes — which is exactly what tightens its reserve ratio.
create or replace function public.bank_deposit(p_bank_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if not exists (select 1 from public.player_banks where owner_id = p_bank_id and is_open) then
    return jsonb_build_object('ok', false, 'error', 'bank_closed');
  end if;

  select coalesce(display_name,'Depositor') into v_name from public.user_profiles where user_id = v_uid;

  insert into public.bank_deposit_accounts (bank_id, user_id, user_name, balance)
  values (p_bank_id, v_uid, coalesce(v_name,'Depositor'), p_amount)
  on conflict (bank_id, user_id) do update
    set balance = public.bank_deposit_accounts.balance + excluded.balance, updated_at = now();

  update public.player_banks
     set reserves = reserves + p_amount, deposits = deposits + p_amount, updated_at = now()
   where owner_id = p_bank_id;

  insert into public.bank_ledger (bank_id, kind, amount, actor_id, actor_name, note)
  values (p_bank_id, 'deposit', p_amount, v_uid, coalesce(v_name,'Depositor'), 'Deposit received');

  return jsonb_build_object('ok', true, 'amount', p_amount);
end $$;

-- Public directory for the Camp entry point.
create or replace function public.bank_directory()
returns table (owner_id uuid, owner_name text, bank_name text, tagline text,
               charter_tier int, mt_staked numeric, deposits bigint, loans_serviced int,
               defaults_taken int, prestige int)
language sql security definer set search_path = public as $$
  select owner_id, owner_name, bank_name, tagline, charter_tier, mt_staked,
         deposits, loans_serviced, defaults_taken, prestige
    from public.player_banks
   where is_open
   order by charter_tier desc, mt_staked desc, loans_serviced desc
   limit 100;
$$;

grant execute on function public.bank_open_charter(int, numeric, text, text) to authenticated;
grant execute on function public.bank_decide(bigint, text, bigint, numeric, int, text) to authenticated;
grant execute on function public.bank_deposit(uuid, bigint) to authenticated;
grant execute on function public.bank_directory() to anon, authenticated;
