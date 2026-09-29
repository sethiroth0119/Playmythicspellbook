-- ════════════════════════════════════════════════════════════════════════
-- 💳 PAID LICENCES AND DEVELOPMENT POINTS — two more real-money rails, the
-- same shape as garage_purchases (supabase-garage.sql), and for the same
-- reasons: a purchase must outlive the browser, and the Worker (service role,
-- after Stripe says paid) is the ONLY writer.
--
--   licence_purchases   one row per (user, licence). A City Hall licence
--                       bought for $12 instead of filed for with Cinder,
--                       materials and a compliance score. The client mirrors
--                       it into Profile.paidLicences and, when the buyer runs a
--                       corporation, into corp_licenses so the corp holds it.
--   devpoint_purchases  one row per checkout. Development points are per
--                       account and REPEATABLE (2 ⬡ for $5, as many times as
--                       the player likes), so there is no (user, sku) unique —
--                       the session id is the idempotency key. The client's
--                       bank is sum(points) − what it has spent.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.licence_purchases (
  id                  bigserial primary key,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  licence_id          text        not null,
  stripe_session_id   text        not null,
  amount_cents        integer     not null default 0,
  created_at          timestamptz not null default now(),
  constraint licence_purchases_session_uniq unique (stripe_session_id),
  constraint licence_purchases_owner_uniq   unique (user_id, licence_id)
);
create index if not exists licence_purchases_user_idx on public.licence_purchases (user_id);
alter table public.licence_purchases enable row level security;
drop policy if exists licence_purchases_own_read on public.licence_purchases;
create policy licence_purchases_own_read on public.licence_purchases for select using (auth.uid() = user_id);
revoke insert, update, delete on public.licence_purchases from anon, authenticated;

create table if not exists public.devpoint_purchases (
  id                  bigserial primary key,
  user_id             uuid        not null references auth.users(id) on delete cascade,
  points              integer     not null default 0,
  stripe_session_id   text        not null,
  amount_cents        integer     not null default 0,
  created_at          timestamptz not null default now(),
  constraint devpoint_purchases_session_uniq unique (stripe_session_id)
);
create index if not exists devpoint_purchases_user_idx on public.devpoint_purchases (user_id);
alter table public.devpoint_purchases enable row level security;
drop policy if exists devpoint_purchases_own_read on public.devpoint_purchases;
create policy devpoint_purchases_own_read on public.devpoint_purchases for select using (auth.uid() = user_id);
revoke insert, update, delete on public.devpoint_purchases from anon, authenticated;

-- ── verify ──────────────────────────────────────────────────────────────
-- select tablename, policyname, cmd from pg_policies
--  where tablename in ('licence_purchases', 'devpoint_purchases');
-- Expect exactly one SELECT policy on each.
