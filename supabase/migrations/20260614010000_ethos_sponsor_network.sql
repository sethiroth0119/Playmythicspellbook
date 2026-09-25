-- =============================================================================
-- 📢 ETHOS SPONSOR NETWORK — node sponsor ads + Stripe Connect marketplace.
-- Run ONCE in the Supabase SQL editor. Idempotent / safe to re-run.
--
-- Tables:
--   tw_node_ads     — the sponsor ad on a District Node (image/video billboard)
--   tw_ad_sellers   — a corp's Stripe Connect account (for ad-sale payouts)
--   tw_ad_orders    — one row per paid ad purchase (the revenue split ledger)
-- RPC:
--   tw_ad_track(ad_id, kind) — atomic +1 to views / clicks (no row read race)
--
-- Split: node owner 70% · studio 20% · Foundation Reserve 10%. Stripe routes
-- 70% to the owner's connected account (destination charge); the 30% platform
-- application fee is split 20/10 in tw_ad_orders by the webhook.
-- =============================================================================

-- ── tw_node_ads ─────────────────────────────────────────────────────────────
create table if not exists public.tw_node_ads (
  id            uuid primary key default gen_random_uuid(),
  node_id       text not null,
  sponsor_name  text not null,
  caption       text,
  ad_type       text not null default 'image',           -- 'image' | 'video'
  media_url     text,
  target_link   text,
  cta_label     text default 'Visit Sponsor',
  reward_tag    text,
  status        text not null default 'pending',          -- pending|active|rejected|paused
  seller        text not null default 'owner',            -- 'owner' | 'studio'
  owner_corp_id uuid,
  price_model   text not null default 'flat',             -- flat|ppc|ppv
  price_cents   integer not null default 0,
  currency      text not null default 'usd',
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  views         bigint not null default 0,
  clicks        bigint not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tw_node_ads_node_idx   on public.tw_node_ads (node_id);
create index if not exists tw_node_ads_status_idx  on public.tw_node_ads (status);
create index if not exists tw_node_ads_owner_idx   on public.tw_node_ads (owner_corp_id);

alter table public.tw_node_ads enable row level security;

-- READ: any signed-in player can read ads. Active ads are public billboards;
-- the owner/admin "manage" list also needs to surface pending ads for review.
drop policy if exists tw_node_ads_sel_active on public.tw_node_ads;
drop policy if exists tw_node_ads_sel on public.tw_node_ads;
create policy tw_node_ads_sel on public.tw_node_ads
  for select to authenticated using (true);

-- INSERT: a player may only create ads attributed to THEMSELVES (created_by =
-- their uid). Status is client-gated — owners submit as 'pending', admins
-- publish as 'active'; a paid ad is flipped 'active' by the webhook (service
-- role). The webhook + admin moderation use the service-role key, not RLS.
drop policy if exists tw_node_ads_ins on public.tw_node_ads;
create policy tw_node_ads_ins on public.tw_node_ads
  for insert to authenticated with check (created_by = auth.uid());

-- UPDATE / DELETE: permissive for authenticated — admin approve/reject/pause/
-- remove is gated in the client, matching this game's existing tw_* admin-
-- content model (tw_regions/sectors use the same `using (true)` pattern).
-- ⚠ PRODUCTION HARDENING: replace `using (true)` with an admins-table /
--   is_admin() check (or move moderation to a service-role Edge Function) so a
--   crafted API call can't approve/edit someone else's ad.
drop policy if exists tw_node_ads_upd on public.tw_node_ads;
create policy tw_node_ads_upd on public.tw_node_ads
  for update to authenticated using (true) with check (true);
drop policy if exists tw_node_ads_del on public.tw_node_ads;
create policy tw_node_ads_del on public.tw_node_ads
  for delete to authenticated using (true);

-- ── tw_ad_track RPC — atomic counter bump (security definer so the bump isn't
--    blocked by RLS, but it only ever +1's views/clicks, never anything else) ──
create or replace function public.tw_ad_track(p_ad_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'view' then
    update public.tw_node_ads set views = views + 1 where id = p_ad_id;
  elsif p_kind = 'click' then
    update public.tw_node_ads set clicks = clicks + 1 where id = p_ad_id;
  end if;
end; $$;
grant execute on function public.tw_ad_track(uuid, text) to authenticated;

-- ── tw_ad_sellers — a corp's Stripe Connect account for payouts ──────────────
create table if not exists public.tw_ad_sellers (
  corp_id            uuid primary key,
  user_id            uuid not null,                 -- the corp member who onboarded
  stripe_account_id  text,                          -- acct_… (Accounts v2)
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.tw_ad_sellers enable row level security;
-- Readable by the owning user; written only by the Edge Functions (service role).
drop policy if exists tw_ad_sellers_sel on public.tw_ad_sellers;
create policy tw_ad_sellers_sel on public.tw_ad_sellers
  for select to authenticated using (user_id = auth.uid());

-- ── tw_ad_orders — revenue-split ledger (one row per paid purchase) ──────────
create table if not exists public.tw_ad_orders (
  id                    uuid primary key default gen_random_uuid(),
  ad_id                 uuid references public.tw_node_ads(id) on delete set null,
  node_id               text,
  owner_corp_id         uuid,
  buyer_user_id         uuid,
  amount_cents          integer not null,
  currency              text not null default 'usd',
  owner_share_cents     integer not null default 0,    -- 70%
  studio_share_cents    integer not null default 0,    -- 20%
  foundation_share_cents integer not null default 0,   -- 10%
  stripe_session_id     text,
  stripe_payment_intent text,
  status                text not null default 'paid',  -- paid|refunded
  created_at            timestamptz not null default now()
);
create index if not exists tw_ad_orders_owner_idx on public.tw_ad_orders (owner_corp_id);
create index if not exists tw_ad_orders_node_idx  on public.tw_ad_orders (node_id);
alter table public.tw_ad_orders enable row level security;
-- A node owner can read their own revenue rows. Studio totals come from the
-- service-role key (admin dashboard / Edge Function).
drop policy if exists tw_ad_orders_sel on public.tw_ad_orders;
create policy tw_ad_orders_sel on public.tw_ad_orders
  for select to authenticated using (buyer_user_id = auth.uid());
