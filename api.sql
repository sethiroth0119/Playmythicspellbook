-- Mythic Spellbook — public Game API setup. Run ONCE in the Supabase SQL
-- editor (idempotent; safe to re-run). Additive — does not touch the
-- Foundation Reserve / corporation tables you already created.
--
-- It does three things:
--   1) economy_nodes  — the in-game NODE SYSTEM data model (you build the
--      node UI later; this is the shared store the game + API use).
--   2) site_updates   — the "Keep up with updates" feed. abraxascodex.com
--      writes rows here with ITS OWN Supabase credentials; the game/API
--      only read it.
--   3) api_* views    — curated, NON-PII, definer views the public read
--      API serves to the anon role (no user ids / emails ever exposed).

-- ── 1) Node system ─────────────────────────────────────────────────────
create table if not exists public.economy_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  corp_id uuid references public.corporations(id) on delete set null,
  name text not null,
  node_type text not null default 'extractor',
  resource text,
  level integer not null default 1,
  status text not null default 'active',
  x numeric default 0,
  y numeric default 0,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists economy_nodes_corp on public.economy_nodes (corp_id);
alter table public.economy_nodes enable row level security;
drop policy if exists en_sel on public.economy_nodes;
create policy en_sel on public.economy_nodes for select to authenticated using (true);
drop policy if exists en_ins on public.economy_nodes;
create policy en_ins on public.economy_nodes for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists en_upd on public.economy_nodes;
create policy en_upd on public.economy_nodes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists en_del on public.economy_nodes;
create policy en_del on public.economy_nodes for delete to authenticated using (owner_id = auth.uid());

-- ── 2) abraxascodex → game updates feed ────────────────────────────────
create table if not exists public.site_updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  tag text,
  url text,
  source text default 'abraxascodex',
  published_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists site_updates_pub on public.site_updates (published_at desc);
alter table public.site_updates enable row level security;
drop policy if exists su_sel on public.site_updates;
create policy su_sel on public.site_updates for select to authenticated using (true);
drop policy if exists su_ins on public.site_updates;
create policy su_ins on public.site_updates for insert to authenticated with check (true);
drop policy if exists su_upd on public.site_updates;
create policy su_upd on public.site_updates for update to authenticated using (true) with check (true);

-- ── 3) Public API views (definer; expose ONLY safe, non-PII columns) ───
-- These are owned by the SQL-editor role so they bypass base-table RLS by
-- design, and we deliberately select only public-safe aggregate columns.
create or replace view public.api_corporations as
  select c.name, c.tag,
         coalesce(c.faction,'') as faction,
         coalesce(c.element,'') as element,
         (select count(*) from public.corp_members m where m.corp_id = c.id) as members,
         c.created_at as founded
  from public.corporations c;

create or replace view public.api_reserve_totals as
  select c.resource,
         greatest(c.contributed - coalesce(x.consumed, 0), 0)::numeric as total,
         c.points, c.contributors
  from (select resource, sum(qty)::numeric as contributed, sum(points)::numeric as points,
               count(distinct user_id) as contributors
        from public.reserve_contributions group by resource) c
  left join (select resource, sum(qty)::numeric as consumed
             from public.reserve_consumption group by resource) x on x.resource = c.resource;

create or replace view public.api_tax_summary as
  select coalesce(sum(tax_amount),0)::numeric as total_tax,
         coalesce(sum(tax_amount) filter (where created_at > now() - interval '1 day'),0)::numeric as day,
         coalesce(sum(tax_amount) filter (where created_at > now() - interval '7 days'),0)::numeric as week,
         coalesce(sum(tax_amount) filter (where created_at > now() - interval '30 days'),0)::numeric as month,
         coalesce(sum(tax_amount) filter (where market_type = 'black'),0)::numeric as black_market,
         coalesce(sum(tax_amount) filter (where corp_id is not null),0)::numeric as corporation,
         count(*) as tx_count
  from public.reserve_tax_log;

create or replace view public.api_nodes as
  select n.id, n.name, n.node_type, n.resource, n.level, n.status, n.x, n.y,
         co.tag as corp_tag, n.created_at
  from public.economy_nodes n
  left join public.corporations co on co.id = n.corp_id
  where n.status <> 'hidden';

create or replace view public.api_updates as
  select id, title, body, tag, url, source, published_at
  from public.site_updates
  where published_at <= now();

-- ── Global node reward pool ledger ─────────────────────────────────────
-- Every node payout is recorded here. The in-game pool = a share of the
-- Foundation Treasury minus sum(amount). Public-read so pool status is
-- auditable; inserts are self-scoped (the collecting operator only).
create table if not exists public.node_payouts (
  id uuid primary key default gen_random_uuid(),
  node_id uuid references public.economy_nodes(id) on delete set null,
  corp_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  amount numeric not null default 0,
  created_at timestamptz default now()
);
create index if not exists node_payouts_time on public.node_payouts (created_at desc);
alter table public.node_payouts enable row level security;
drop policy if exists np_sel on public.node_payouts;
create policy np_sel on public.node_payouts for select to authenticated using (true);
drop policy if exists np_ins on public.node_payouts;
create policy np_ins on public.node_payouts for insert to authenticated with check (user_id = auth.uid());

-- ── Cashout (withdrawal) audit log ─────────────────────────────────────
-- Tamper-evident transaction trail for the (mock) Cinder → cash payout
-- pipeline. Contains NO bank / card / ID data — only the in-game amount,
-- a non-sensitive method label, status and the safeguard reason. A row is
-- append-only (no update/delete policy) and each user can read only their
-- own rows. Real KYC + settlement happen off-platform via a licensed
-- processor in a live build; this table never stores PII.
create table if not exists public.cashout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cinders numeric not null default 0,
  usd numeric not null default 0,
  method text,
  status text not null default 'pending',
  reason text,
  created_at timestamptz default now()
);
create index if not exists cashout_requests_user on public.cashout_requests (user_id, created_at desc);
alter table public.cashout_requests enable row level security;
drop policy if exists cor_sel on public.cashout_requests;
create policy cor_sel on public.cashout_requests for select to authenticated using (user_id = auth.uid());
drop policy if exists cor_ins on public.cashout_requests;
create policy cor_ins on public.cashout_requests for insert to authenticated with check (user_id = auth.uid());

grant select on
  public.api_corporations,
  public.api_reserve_totals,
  public.api_tax_summary,
  public.api_nodes,
  public.api_updates
to anon, authenticated;
