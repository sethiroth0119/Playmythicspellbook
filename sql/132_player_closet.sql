-- ============================================================================
-- 132_player_closet.sql
-- 👕 Player Closet — the clothing CATALOGUE: brands, clothing items and the
-- characters (bodies) players dress. Idempotent. Re-runnable. RLS ships here.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Until applied the Closet Studio saves to the author's device only (it says
-- so) and the Player Closet shows whatever that device holds; every other
-- feature keeps working.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.closet_brands   a label players shop by (name, tagline, logo, colour)
--  public.closet_items    one piece of clothing: category, model URL, the FIT
--                         record (how it hangs on a measured body part), price
--  public.closet_bodies   a base character the creator dresses (model URL)
--
--  Every row is { id, owner_id, owner_name, published, data jsonb }. The
--  record itself lives in `data` (see /src/closet/closet.model.js) so a new
--  field never needs a migration; the columns beside it are what policies
--  and listings need.
--
--  The model BYTES are not here: an item references a URL — an Athena FILES
--  upload (world_assets → the `models` bucket, sql/112), a project model
--  under /models/, or any CORS host. Nothing new is hosted by this file.
--
--  Visibility: every signed-in player READS published rows plus their own
--  drafts; the owner or an admin writes and deletes. Ownership of clothing
--  by PLAYERS and the outfit they wear are NOT tables — they ride the
--  profile's forge JSONB (Profile.closet, index.html) like avatars, sleeves
--  and tombstones, and a purchase spends through spendGems(): one cosmetic
--  pattern, no second wallet.
-- ============================================================================

begin;

-- ── helper: is the caller an admin? (the same JWT claim world_assets uses) ──
create or replace function public.closet_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin';
$$;

-- ── brands ──────────────────────────────────────────────────────────────────
create table if not exists public.closet_brands (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  published   boolean not null default true,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint closet_brands_id_chk   check (id ~ '^[A-Za-z0-9_-]{2,64}$'),
  constraint closet_brands_data_chk check (pg_column_size(data) <= 8192)
);
create index if not exists closet_brands_owner_idx on public.closet_brands (owner_id, updated_at desc);
alter table public.closet_brands enable row level security;

drop policy if exists closet_brands_select on public.closet_brands;
create policy closet_brands_select on public.closet_brands for select
  to authenticated using (published or owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_brands_insert on public.closet_brands;
create policy closet_brands_insert on public.closet_brands for insert
  to authenticated with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_brands_update on public.closet_brands;
create policy closet_brands_update on public.closet_brands for update
  to authenticated
  using (owner_id = auth.uid() or public.closet_is_admin())
  with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_brands_delete on public.closet_brands;
create policy closet_brands_delete on public.closet_brands for delete
  to authenticated using (owner_id = auth.uid() or public.closet_is_admin());

-- ── clothing ────────────────────────────────────────────────────────────────
create table if not exists public.closet_items (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  published   boolean not null default true,
  data        jsonb not null default '{}'::jsonb,   -- { brand, cat, name, url, fit, dims, price, currency, tags }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint closet_items_id_chk   check (id ~ '^[A-Za-z0-9_-]{2,64}$'),
  constraint closet_items_data_chk check (pg_column_size(data) <= 16384)
);
create index if not exists closet_items_owner_idx on public.closet_items (owner_id, updated_at desc);
create index if not exists closet_items_pub_idx   on public.closet_items (published, updated_at desc);
create index if not exists closet_items_cat_idx   on public.closet_items ((data ->> 'cat'));
create index if not exists closet_items_brand_idx on public.closet_items ((data ->> 'brand'));
alter table public.closet_items enable row level security;

drop policy if exists closet_items_select on public.closet_items;
create policy closet_items_select on public.closet_items for select
  to authenticated using (published or owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_items_insert on public.closet_items;
create policy closet_items_insert on public.closet_items for insert
  to authenticated with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_items_update on public.closet_items;
create policy closet_items_update on public.closet_items for update
  to authenticated
  using (owner_id = auth.uid() or public.closet_is_admin())
  with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_items_delete on public.closet_items;
create policy closet_items_delete on public.closet_items for delete
  to authenticated using (owner_id = auth.uid() or public.closet_is_admin());

-- ── characters (bodies) ─────────────────────────────────────────────────────
create table if not exists public.closet_bodies (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  published   boolean not null default true,
  data        jsonb not null default '{}'::jsonb,   -- { name, url, scale, faces, anim }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint closet_bodies_id_chk   check (id ~ '^[A-Za-z0-9_-]{2,64}$'),
  constraint closet_bodies_data_chk check (pg_column_size(data) <= 8192)
);
create index if not exists closet_bodies_owner_idx on public.closet_bodies (owner_id, updated_at desc);
alter table public.closet_bodies enable row level security;

drop policy if exists closet_bodies_select on public.closet_bodies;
create policy closet_bodies_select on public.closet_bodies for select
  to authenticated using (published or owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_bodies_insert on public.closet_bodies;
create policy closet_bodies_insert on public.closet_bodies for insert
  to authenticated with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_bodies_update on public.closet_bodies;
create policy closet_bodies_update on public.closet_bodies for update
  to authenticated
  using (owner_id = auth.uid() or public.closet_is_admin())
  with check (owner_id = auth.uid() or public.closet_is_admin());

drop policy if exists closet_bodies_delete on public.closet_bodies;
create policy closet_bodies_delete on public.closet_bodies for delete
  to authenticated using (owner_id = auth.uid() or public.closet_is_admin());

-- ── updated_at, kept by the server so the client's clock never orders the list ──
create or replace function public.closet_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists closet_brands_touch on public.closet_brands;
create trigger closet_brands_touch before update on public.closet_brands for each row execute function public.closet_touch_updated_at();
drop trigger if exists closet_items_touch on public.closet_items;
create trigger closet_items_touch before update on public.closet_items for each row execute function public.closet_touch_updated_at();
drop trigger if exists closet_bodies_touch on public.closet_bodies;
create trigger closet_bodies_touch before update on public.closet_bodies for each row execute function public.closet_touch_updated_at();

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'closet_brands table' as check_name,
       case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'closet_brands') then 'ok' else 'MISSING' end as result
union all
select 'closet_items table',  case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'closet_items') then 'ok' else 'MISSING' end
union all
select 'closet_bodies table', case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'closet_bodies') then 'ok' else 'MISSING' end
union all
select 'rls brands', case when (select relrowsecurity from pg_class where oid = 'public.closet_brands'::regclass) then 'ok' else 'MISSING' end
union all
select 'rls items',  case when (select relrowsecurity from pg_class where oid = 'public.closet_items'::regclass) then 'ok' else 'MISSING' end
union all
select 'rls bodies', case when (select relrowsecurity from pg_class where oid = 'public.closet_bodies'::regclass) then 'ok' else 'MISSING' end
union all
select 'policies', case when (select count(*) from pg_policies where schemaname = 'public' and tablename in ('closet_brands', 'closet_items', 'closet_bodies')) = 12 then 'ok' else 'MISSING' end;
