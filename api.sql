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

-- ── Stripe Connect account map ─────────────────────────────────────────
-- One row per user → their Stripe connected-account id (created via
-- Stripe-hosted onboarding; KYC + bank details live on STRIPE, never here).
-- Self-scoped RLS; the Worker reads/writes this AS THE USER (their JWT).
create table if not exists public.cashout_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.cashout_accounts enable row level security;
drop policy if exists ca_sel on public.cashout_accounts;
create policy ca_sel on public.cashout_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists ca_ins on public.cashout_accounts;
create policy ca_ins on public.cashout_accounts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ca_upd on public.cashout_accounts;
create policy ca_upd on public.cashout_accounts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Aza coin purchases (Stripe Checkout) ───────────────────────────────
-- One row per PAID Stripe Checkout Session. session_id is UNIQUE, so a
-- given paid session credits Aza exactly once even across reloads/devices
-- (the client inserts on its own JWT after the Worker verifies the payment
-- with Stripe). No card/PII here — only the in-game coin amount + the
-- Stripe session id.
create table if not exists public.aza_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null unique,
  aza numeric not null default 0,
  created_at timestamptz default now()
);
alter table public.aza_purchases enable row level security;
drop policy if exists ap_sel on public.aza_purchases;
create policy ap_sel on public.aza_purchases for select to authenticated using (user_id = auth.uid());
drop policy if exists ap_ins on public.aza_purchases;
create policy ap_ins on public.aza_purchases for insert to authenticated with check (user_id = auth.uid());

-- ── Player handle directory (for the Courtroom file-a-case search) ─────
-- Exposes ONLY the public handle + user id from user_profiles — no email,
-- gems, decks or any private column. Definer view (bypasses the private
-- per-user RLS on user_profiles by design, selecting only public-safe
-- columns), granted to authenticated so signed-in players can search.
create or replace view public.api_players as
  select user_id, coalesce(display_name, '') as handle
  from public.user_profiles
  where display_name is not null and btrim(display_name) <> '';

-- ── Gift inbox (player rewards + admin grants) ─────────────────────────
-- The game's "You got a gift" inbox. Players read/claim their own pending
-- gifts; ADMINS (email allowlist) insert gifts for anyone. Admin grants of
-- Cinders/Aza/resources/items/cards/nodes/coupons all land here as a
-- claimable row (card_id encodes the kind; no schema churn per reward).
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  to_user uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  card_name text,
  qty numeric not null default 1,
  message text,
  from_label text default 'Mythic Spellbook',
  status text not null default 'pending',
  created_at timestamptz default now(),
  claimed_at timestamptz
);
create index if not exists gifts_to_user on public.gifts (to_user, status);
alter table public.gifts enable row level security;
-- Admin allowlist via the verified top-level JWT email claim (NOT
-- user_metadata — safe for authz). security invoker (default).
create or replace function public.is_admin() returns boolean
  language sql stable as $$
  select lower(coalesce((auth.jwt() ->> 'email'), '')) in
    ('richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com')
$$;
drop policy if exists gifts_sel on public.gifts;
create policy gifts_sel on public.gifts for select to authenticated using (to_user = auth.uid() or public.is_admin());
drop policy if exists gifts_ins on public.gifts;
create policy gifts_ins on public.gifts for insert to authenticated with check (public.is_admin());
drop policy if exists gifts_upd on public.gifts;
create policy gifts_upd on public.gifts for update to authenticated using (to_user = auth.uid()) with check (to_user = auth.uid());

-- ── Bank of Ethos — per-player Cinder treasury account ─────────────────
-- Players deposit/withdraw Cinder here; a 200-Cinder maintenance fee per
-- 30-day period is debited and routed to the Foundation Reserve. Self-RLS
-- single-writer (same pattern as reserve_contributions).
create table if not exists public.bank_of_ethos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric not null default 0,
  aza numeric not null default 0,
  resources jsonb not null default '{}'::jsonb,
  opened_at timestamptz default now(),
  last_fee_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Idempotent upgrades for accounts created before Aza/resource banking.
alter table public.bank_of_ethos add column if not exists aza numeric not null default 0;
alter table public.bank_of_ethos add column if not exists resources jsonb not null default '{}'::jsonb;
alter table public.bank_of_ethos enable row level security;
drop policy if exists boe_sel on public.bank_of_ethos;
create policy boe_sel on public.bank_of_ethos for select to authenticated using (user_id = auth.uid());
drop policy if exists boe_ins on public.bank_of_ethos;
create policy boe_ins on public.bank_of_ethos for insert to authenticated with check (user_id = auth.uid());
drop policy if exists boe_upd on public.bank_of_ethos;
create policy boe_upd on public.bank_of_ethos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.bank_of_ethos add column if not exists handle text;

-- 📒 Transaction ledger — self-scoped, append-only in practice. Every bank
-- deposit / withdraw / exchange / resource move / request settlement logs
-- one signed row here so the Ledger view + PDF statement are real.
create table if not exists public.boe_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  kind text not null,
  cinder numeric not null default 0,
  aza numeric not null default 0,
  note text,
  counterparty text
);
create index if not exists boe_ledger_user_ts on public.boe_ledger (user_id, ts desc);
alter table public.boe_ledger enable row level security;
drop policy if exists boe_led_sel on public.boe_ledger;
create policy boe_led_sel on public.boe_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists boe_led_ins on public.boe_ledger;
create policy boe_led_ins on public.boe_ledger for insert to authenticated with check (user_id = auth.uid());

-- 🪪 Handle directory — ONLY user_id ↔ @handle ↔ label (no balances), so a
-- player can resolve "request cinder from @someone" without exposing any
-- private bank data. Readable by any signed-in player; writable only by
-- its owner.
create table if not exists public.boe_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text,
  label text,
  updated_at timestamptz default now()
);
create index if not exists boe_directory_handle on public.boe_directory (lower(handle));
alter table public.boe_directory enable row level security;
drop policy if exists boe_dir_sel on public.boe_directory;
create policy boe_dir_sel on public.boe_directory for select to authenticated using (true);
drop policy if exists boe_dir_ins on public.boe_directory;
create policy boe_dir_ins on public.boe_directory for insert to authenticated with check (user_id = auth.uid());
drop policy if exists boe_dir_upd on public.boe_directory;
create policy boe_dir_upd on public.boe_directory for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 💸 Cinder requests — player asks another Bank of Ethos holder for Cinder.
-- to_user is resolved from boe_directory at creation. Settlement is
-- claim-on-read (no cross-user writes): payer debits self + sets 'paid';
-- requester self-credits on next open + sets 'settled'. Both sides only
-- ever write their own bank row, so RLS stays single-writer-safe.
create table if not exists public.boe_requests (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  from_handle text,
  from_label text,
  to_user uuid not null references auth.users(id) on delete cascade,
  to_handle text,
  amount numeric not null check (amount > 0),
  message text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  resolved_at timestamptz
);
create index if not exists boe_req_to on public.boe_requests (to_user, status);
create index if not exists boe_req_from on public.boe_requests (from_user, status);
alter table public.boe_requests enable row level security;
drop policy if exists boe_req_sel on public.boe_requests;
create policy boe_req_sel on public.boe_requests for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());
drop policy if exists boe_req_ins on public.boe_requests;
create policy boe_req_ins on public.boe_requests for insert to authenticated with check (from_user = auth.uid());
drop policy if exists boe_req_upd on public.boe_requests;
create policy boe_req_upd on public.boe_requests for update to authenticated using (from_user = auth.uid() or to_user = auth.uid()) with check (from_user = auth.uid() or to_user = auth.uid());

-- 🏦 Loans — apply for up to 20 Aza (capped to (sum of owned-hero levels) / 5),
-- credited to the bank as Cinder at the canonical peg, repaid in Cinder on a
-- weekly installment schedule. Self-RLS: borrower reads/writes own only.
create table if not exists public.boe_loans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  aza_amount numeric not null check (aza_amount > 0),
  cinder_owed numeric not null check (cinder_owed > 0),
  cinder_paid numeric not null default 0,
  installments int not null default 4 check (installments between 1 and 24),
  period_days int not null default 7 check (period_days between 1 and 90),
  status text not null default 'active',
  started_at timestamptz default now(),
  closed_at timestamptz,
  hero_capacity_aza numeric not null default 0,
  note text
);
create index if not exists boe_loans_user_status on public.boe_loans (user_id, status, started_at desc);
alter table public.boe_loans enable row level security;
drop policy if exists boe_ln_sel on public.boe_loans;
create policy boe_ln_sel on public.boe_loans for select to authenticated using (user_id = auth.uid());
drop policy if exists boe_ln_ins on public.boe_loans;
create policy boe_ln_ins on public.boe_loans for insert to authenticated with check (user_id = auth.uid());
drop policy if exists boe_ln_upd on public.boe_loans;
create policy boe_ln_upd on public.boe_loans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 🪖 Mercenary marketplace — players post themselves as available for work
-- (boe_merc_listings, read-any · write-own); employers hire from the board
-- by creating a contract (boe_merc_contracts, visible to either party).
-- Earnings split 40 % mercenary · 52 % employer · 8 % Foundation Reserve
-- tax (4 % each side), minted at clock-out from the contract's target.
create table if not exists public.boe_merc_listings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  handle text,
  label text,
  rate_per_hour numeric not null default 0,
  bio text,
  status text not null default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists boe_mlist_status on public.boe_merc_listings (status, updated_at desc);
create index if not exists boe_mlist_user on public.boe_merc_listings (user_id);
alter table public.boe_merc_listings enable row level security;
drop policy if exists boe_mlist_sel on public.boe_merc_listings;
create policy boe_mlist_sel on public.boe_merc_listings for select to authenticated using (true);
drop policy if exists boe_mlist_ins on public.boe_merc_listings;
create policy boe_mlist_ins on public.boe_merc_listings for insert to authenticated with check (user_id = auth.uid());
drop policy if exists boe_mlist_upd on public.boe_merc_listings;
create policy boe_mlist_upd on public.boe_merc_listings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists boe_mlist_del on public.boe_merc_listings;
create policy boe_mlist_del on public.boe_merc_listings for delete to authenticated using (user_id = auth.uid());

create table if not exists public.boe_merc_contracts (
  id bigint generated always as identity primary key,
  employer_user uuid not null references auth.users(id) on delete cascade,
  employer_handle text,
  employer_label text,
  mercenary_user uuid not null references auth.users(id) on delete cascade,
  mercenary_handle text,
  mercenary_label text,
  hours int not null default 1 check (hours between 1 and 24),
  target_cinder numeric not null check (target_cinder > 0),
  status text not null default 'offered',  -- offered|active|paused|completed_pending_merc|completed_pending_employer|completed|cancelled
  created_at timestamptz default now(),
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  pause_ms_accum int not null default 0,
  paused_at timestamptz,
  merc_payout numeric not null default 0,
  employer_payout numeric not null default 0,
  fr_tax numeric not null default 0
);
create index if not exists boe_mcon_emp on public.boe_merc_contracts (employer_user, status, created_at desc);
create index if not exists boe_mcon_mer on public.boe_merc_contracts (mercenary_user, status, created_at desc);
alter table public.boe_merc_contracts enable row level security;
drop policy if exists boe_mcon_sel on public.boe_merc_contracts;
create policy boe_mcon_sel on public.boe_merc_contracts for select to authenticated using (employer_user = auth.uid() or mercenary_user = auth.uid());
drop policy if exists boe_mcon_ins on public.boe_merc_contracts;
create policy boe_mcon_ins on public.boe_merc_contracts for insert to authenticated with check (employer_user = auth.uid());
drop policy if exists boe_mcon_upd on public.boe_merc_contracts;
create policy boe_mcon_upd on public.boe_merc_contracts for update to authenticated using (employer_user = auth.uid() or mercenary_user = auth.uid()) with check (employer_user = auth.uid() or mercenary_user = auth.uid());

-- 📝 Contract postings — either side posts a specific job:
--   poster_role = 'merc'      → "I'll do X work for Y Cinder over Z hours"
--   poster_role = 'employer'  → "I need X done for Y Cinder over Z hours"
-- Anyone can browse open posts; accepting one creates a boe_merc_contracts
-- row with the accepter taking the opposite role.
create table if not exists public.boe_merc_posts (
  id bigint generated always as identity primary key,
  poster_user uuid not null references auth.users(id) on delete cascade,
  poster_handle text,
  poster_label text,
  poster_role text not null check (poster_role in ('merc', 'employer')),
  hours int not null default 1 check (hours between 1 and 24),
  target_cinder numeric not null check (target_cinder > 0),
  description text,
  status text not null default 'open',  -- open|taken|cancelled
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  accepted_by uuid references auth.users(id) on delete set null,
  contract_id bigint
);
create index if not exists boe_mpost_status on public.boe_merc_posts (status, updated_at desc);
create index if not exists boe_mpost_poster on public.boe_merc_posts (poster_user);
alter table public.boe_merc_posts enable row level security;
drop policy if exists boe_mpost_sel on public.boe_merc_posts;
create policy boe_mpost_sel on public.boe_merc_posts for select to authenticated using (true);
drop policy if exists boe_mpost_ins on public.boe_merc_posts;
create policy boe_mpost_ins on public.boe_merc_posts for insert to authenticated with check (poster_user = auth.uid());
-- Either the poster (cancel) or an accepter (flip 'taken' + stamp self
-- as accepted_by) may update. USING is broad (any authenticated user may
-- target a row) but WITH CHECK pins the new row to a valid actor.
drop policy if exists boe_mpost_upd on public.boe_merc_posts;
create policy boe_mpost_upd on public.boe_merc_posts for update to authenticated using (true) with check (poster_user = auth.uid() or accepted_by = auth.uid());
drop policy if exists boe_mpost_del on public.boe_merc_posts;
create policy boe_mpost_del on public.boe_merc_posts for delete to authenticated using (poster_user = auth.uid());

-- 🛒 Bank of Ethos Marketplace — players list cards / items / resources /
-- relics for sale (buy-now) or auction. The listed inventory (cards,
-- resources) is escrowed off the seller's side at listing time and
-- delivered to the buyer at purchase time (buyer writes their own bank
-- to pay; seller settles their payout on next bank open).
create table if not exists public.boe_market_listings (
  id bigint generated always as identity primary key,
  seller_user uuid not null references auth.users(id) on delete cascade,
  seller_handle text, seller_label text,
  kind text not null check (kind in ('card', 'item', 'resource', 'relic')),
  item_id text,
  item_name text not null,
  item_icon text,
  qty numeric not null check (qty > 0),
  currency text not null check (currency in ('cinder', 'aza')) default 'cinder',
  price numeric not null check (price > 0),
  is_auction boolean not null default false,
  current_bid numeric,
  current_bidder_user uuid references auth.users(id) on delete set null,
  current_bidder_handle text,
  ends_at timestamptz,
  status text not null default 'active',  -- active|sold_pending_seller|paid|cancelled|auction_resolved
  buyer_user uuid references auth.users(id) on delete set null,
  buyer_handle text,
  created_at timestamptz default now(),
  sold_at timestamptz,
  settled_at timestamptz
);
create index if not exists boe_mkt_status on public.boe_market_listings (status, created_at desc);
create index if not exists boe_mkt_seller on public.boe_market_listings (seller_user, status, created_at desc);
create index if not exists boe_mkt_buyer on public.boe_market_listings (buyer_user, status);
alter table public.boe_market_listings enable row level security;
drop policy if exists boe_mkt_sel on public.boe_market_listings;
create policy boe_mkt_sel on public.boe_market_listings for select to authenticated using (true);
drop policy if exists boe_mkt_ins on public.boe_market_listings;
create policy boe_mkt_ins on public.boe_market_listings for insert to authenticated with check (seller_user = auth.uid());
-- USING is broad so a buyer can flip status; WITH CHECK pins the new row
-- to a valid actor (seller cancels / settles, or buyer/bidder updates).
drop policy if exists boe_mkt_upd on public.boe_market_listings;
create policy boe_mkt_upd on public.boe_market_listings for update to authenticated using (true) with check (seller_user = auth.uid() or buyer_user = auth.uid() or current_bidder_user = auth.uid());

grant select on
  public.api_corporations,
  public.api_reserve_totals,
  public.api_tax_summary,
  public.api_nodes,
  public.api_updates,
  public.api_players
to anon, authenticated;
