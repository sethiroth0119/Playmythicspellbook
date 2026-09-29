-- ════════════════════════════════════════════════════════════════════════
-- 🚚 GARAGE PURCHASES — permanent convoy-rig unlocks bought with real money.
--
-- OPTIONAL BUT STRONGLY RECOMMENDED. The rigs work without this table: the
-- game keeps them in the cloud-synced profile, and the Worker degrades
-- quietly when the table is absent (/api/garage/owned answers
-- {durable:false} and the client keeps trusting its own copy).
--
-- What you get by running it: ownership survives a cleared browser, a reset
-- profile, or a brand-new device, because the Worker can replay it from
-- here. It is also what stops a rig being SOLD TWICE — /api/garage/checkout
-- refuses a sku already recorded against the buyer.
--
-- Run in the Supabase SQL editor for the GAME project.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.garage_purchases (
  id                  bigserial primary key,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  sku                 text        not null,
  stripe_session_id   text        not null,
  created_at          timestamptz not null default now(),
  -- Idempotency: replaying the return URL, or a webhook landing after the
  -- player already came back, must never create a second row.
  constraint garage_purchases_session_uniq unique (stripe_session_id),
  -- One permanent unlock per account. This is the constraint that makes
  -- "buy it once" true even if two checkouts somehow complete.
  constraint garage_purchases_owner_sku_uniq unique (user_id, sku)
);

create index if not exists garage_purchases_user_idx on public.garage_purchases (user_id);

alter table public.garage_purchases enable row level security;

-- Players may READ their own purchases (useful for support and for any
-- future client-side restore), but may never write them. Only the Worker,
-- holding the service role, records a purchase — and it does so only after
-- Stripe has confirmed payment_status = 'paid' for that user's session.
-- Without this split a player could simply insert a row and grant themselves
-- a $99 rig.
drop policy if exists garage_purchases_own_read on public.garage_purchases;
create policy garage_purchases_own_read
  on public.garage_purchases for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy is defined on purpose: with RLS enabled and
-- no policy, anon and authenticated are refused every write. service_role
-- bypasses RLS, which is exactly the Worker.
revoke insert, update, delete on public.garage_purchases from anon, authenticated;

-- ── verify ──────────────────────────────────────────────────────────────
-- select * from pg_policies where tablename = 'garage_purchases';
-- Expect exactly one row: garage_purchases_own_read (SELECT).
