create table if not exists public.reserve_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  resource text not null,
  qty numeric not null default 0,
  points numeric not null default 0,
  updated_at timestamptz default now(),
  unique (user_id, resource)
);
alter table public.reserve_contributions enable row level security;
drop policy if exists rc_sel on public.reserve_contributions;
create policy rc_sel on public.reserve_contributions for select to authenticated using (true);
drop policy if exists rc_ins on public.reserve_contributions;
create policy rc_ins on public.reserve_contributions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists rc_upd on public.reserve_contributions;
create policy rc_upd on public.reserve_contributions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table if not exists public.reserve_consumption (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null,
  qty numeric not null default 0,
  product text,
  created_at timestamptz default now()
);
alter table public.reserve_consumption enable row level security;
drop policy if exists rx_sel on public.reserve_consumption;
create policy rx_sel on public.reserve_consumption for select to authenticated using (true);
drop policy if exists rx_ins on public.reserve_consumption;
create policy rx_ins on public.reserve_consumption for insert to authenticated with check (user_id = auth.uid());
create table if not exists public.reserve_tax_log (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid,
  corp_id text,
  resource text,
  quantity numeric not null default 0,
  sale_value numeric not null default 0,
  tax_rate numeric not null default 0.02,
  tax_amount numeric not null default 0,
  market_type text not null default 'base',
  created_at timestamptz default now()
);
create index if not exists reserve_tax_log_time on public.reserve_tax_log (created_at desc);
alter table public.reserve_tax_log enable row level security;
drop policy if exists tx_sel on public.reserve_tax_log;
create policy tx_sel on public.reserve_tax_log for select to authenticated using (true);
drop policy if exists tx_ins on public.reserve_tax_log;
create policy tx_ins on public.reserve_tax_log for insert to authenticated with check (seller_id = auth.uid());
create table if not exists public.corporations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text not null,
  founder_id uuid not null references auth.users(id) on delete cascade,
  faction text,
  element text,
  created_at timestamptz default now()
);
alter table public.corporations add column if not exists faction text;
alter table public.corporations add column if not exists element text;
create table if not exists public.corp_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  corp_id uuid not null references public.corporations(id) on delete cascade,
  user_name text,
  role text not null default 'member',
  joined_at timestamptz default now()
);
create index if not exists corp_members_corp on public.corp_members (corp_id);
alter table public.corporations enable row level security;
alter table public.corp_members enable row level security;
drop policy if exists corp_sel on public.corporations;
create policy corp_sel on public.corporations for select to authenticated using (true);
drop policy if exists corp_ins on public.corporations;
create policy corp_ins on public.corporations for insert to authenticated with check (founder_id = auth.uid());
drop policy if exists cm_sel on public.corp_members;
create policy cm_sel on public.corp_members for select to authenticated using (true);
drop policy if exists cm_ins on public.corp_members;
create policy cm_ins on public.corp_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists cm_upd on public.corp_members;
create policy cm_upd on public.corp_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cm_del on public.corp_members;
create policy cm_del on public.corp_members for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.corporations c where c.id = corp_members.corp_id and c.founder_id = auth.uid()));
create table if not exists public.corp_requests (
  id uuid primary key default gen_random_uuid(),
  corp_id uuid not null references public.corporations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  role text not null default 'member',
  status text not null default 'pending',
  created_at timestamptz default now(),
  unique (corp_id, user_id)
);
create index if not exists corp_requests_corp on public.corp_requests (corp_id);
alter table public.corp_requests enable row level security;
drop policy if exists creq_sel on public.corp_requests;
create policy creq_sel on public.corp_requests for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.corporations c where c.id = corp_requests.corp_id and c.founder_id = auth.uid()));
drop policy if exists creq_ins on public.corp_requests;
create policy creq_ins on public.corp_requests for insert to authenticated with check (user_id = auth.uid());
drop policy if exists creq_upd on public.corp_requests;
create policy creq_upd on public.corp_requests for update to authenticated using (user_id = auth.uid() or exists (select 1 from public.corporations c where c.id = corp_requests.corp_id and c.founder_id = auth.uid())) with check (true);
drop policy if exists creq_del on public.corp_requests;
create policy creq_del on public.corp_requests for delete to authenticated using (user_id = auth.uid() or exists (select 1 from public.corporations c where c.id = corp_requests.corp_id and c.founder_id = auth.uid()));
create table if not exists public.corp_vault (
  id uuid primary key default gen_random_uuid(),
  corp_id uuid not null references public.corporations(id) on delete cascade,
  depositor_id uuid not null references auth.users(id) on delete cascade,
  depositor_name text,
  kind text not null,
  item_id text not null,
  name text,
  icon text,
  qty numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (corp_id, depositor_id, kind, item_id)
);
create index if not exists corp_vault_corp on public.corp_vault (corp_id);
alter table public.corp_vault enable row level security;
drop policy if exists cv_sel on public.corp_vault;
create policy cv_sel on public.corp_vault for select to authenticated using (exists (select 1 from public.corp_members m where m.corp_id = corp_vault.corp_id and m.user_id = auth.uid()) or exists (select 1 from public.corporations c where c.id = corp_vault.corp_id and c.founder_id = auth.uid()));
drop policy if exists cv_ins on public.corp_vault;
create policy cv_ins on public.corp_vault for insert to authenticated with check (depositor_id = auth.uid() and exists (select 1 from public.corp_members m where m.corp_id = corp_vault.corp_id and m.user_id = auth.uid()));
drop policy if exists cv_upd on public.corp_vault;
create policy cv_upd on public.corp_vault for update to authenticated using (depositor_id = auth.uid()) with check (depositor_id = auth.uid());
drop policy if exists cv_del on public.corp_vault;
create policy cv_del on public.corp_vault for delete to authenticated using (depositor_id = auth.uid() or exists (select 1 from public.corporations c where c.id = corp_vault.corp_id and c.founder_id = auth.uid()));
drop view if exists public.reserve_totals;
create view public.reserve_totals with (security_invoker = true) as
  select c.resource, greatest(c.contributed - coalesce(x.consumed, 0), 0)::numeric as total, c.points, c.contributors
  from (select resource, sum(qty)::numeric as contributed, sum(points)::numeric as points, count(distinct user_id) as contributors from public.reserve_contributions group by resource) c
  left join (select resource, sum(qty)::numeric as consumed from public.reserve_consumption group by resource) x on x.resource = c.resource;
create table if not exists public.corp_licenses (
  id uuid primary key default gen_random_uuid(),
  corp_id uuid not null references public.corporations(id) on delete cascade,
  license_type text not null,
  status text not null default 'active',
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz default now(),
  unique (corp_id, license_type)
);
create index if not exists corp_licenses_corp on public.corp_licenses (corp_id);
alter table public.corp_licenses enable row level security;
drop policy if exists cl_sel on public.corp_licenses;
create policy cl_sel on public.corp_licenses for select to authenticated using (true);
drop policy if exists cl_ins on public.corp_licenses;
create policy cl_ins on public.corp_licenses for insert to authenticated with check (exists (select 1 from public.corporations c where c.id = corp_licenses.corp_id and c.founder_id = auth.uid()));
drop policy if exists cl_del on public.corp_licenses;
create policy cl_del on public.corp_licenses for delete to authenticated using (exists (select 1 from public.corporations c where c.id = corp_licenses.corp_id and c.founder_id = auth.uid()));
create table if not exists public.court_officials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_name text,
  role text not null default 'lawyer',
  rank text not null default 'Associate',
  status text not null default 'active',
  registered_at timestamptz default now()
);
alter table public.court_officials enable row level security;
drop policy if exists cof_sel on public.court_officials;
create policy cof_sel on public.court_officials for select to authenticated using (true);
drop policy if exists cof_ins on public.court_officials;
create policy cof_ins on public.court_officials for insert to authenticated with check (user_id = auth.uid());
drop policy if exists cof_upd on public.court_officials;
create policy cof_upd on public.court_officials for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create table if not exists public.court_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text,
  plaintiff_id uuid references auth.users(id) on delete set null,
  plaintiff_name text,
  defendant_name text not null,
  crime_type text not null,
  severity int not null default 3,
  summary text,
  status text not null default 'open',
  judge_id uuid references auth.users(id) on delete set null,
  judge_name text,
  prosecutor_name text,
  defender_name text,
  verdict text,
  sentence text,
  filed_by uuid references auth.users(id) on delete set null,
  filed_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists court_cases_time on public.court_cases (filed_at desc);
alter table public.court_cases enable row level security;
drop policy if exists ccz_sel on public.court_cases;
create policy ccz_sel on public.court_cases for select to authenticated using (true);
drop policy if exists ccz_ins on public.court_cases;
create policy ccz_ins on public.court_cases for insert to authenticated with check (filed_by = auth.uid());
drop policy if exists ccz_upd on public.court_cases;
create policy ccz_upd on public.court_cases for update to authenticated using (true) with check (true);
create table if not exists public.court_records (
  id uuid primary key default gen_random_uuid(),
  offender_name text not null,
  crime_type text,
  severity int not null default 3,
  verdict text,
  sentence text,
  case_id uuid references public.court_cases(id) on delete set null,
  judge_name text,
  recorded_at timestamptz default now()
);
create index if not exists court_records_time on public.court_records (recorded_at desc);
alter table public.court_records enable row level security;
drop policy if exists crr_sel on public.court_records;
create policy crr_sel on public.court_records for select to authenticated using (true);
drop policy if exists crr_ins on public.court_records;
create policy crr_ins on public.court_records for insert to authenticated with check (true);
create table if not exists public.detention (
  id uuid primary key default gen_random_uuid(),
  offender_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  crime_type text,
  severity int not null default 3,
  status text not null default 'jailed',
  jailed_at timestamptz default now(),
  release_at timestamptz,
  bail_cinder numeric not null default 0,
  seize_cinder numeric not null default 0,
  seized_done boolean not null default false,
  case_id uuid references public.court_cases(id) on delete set null,
  committed_by uuid references auth.users(id) on delete set null,
  committed_name text,
  released_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists detention_status on public.detention (status, release_at);
alter table public.detention enable row level security;
drop policy if exists det_sel on public.detention;
create policy det_sel on public.detention for select to authenticated using (true);
drop policy if exists det_ins on public.detention;
create policy det_ins on public.detention for insert to authenticated with check (true);
drop policy if exists det_upd on public.detention;
create policy det_upd on public.detention for update to authenticated using (true) with check (true);
grant select on public.reserve_totals to authenticated;
