-- ============================================================================
-- 040_ui_widgets.sql
-- Athena Widgets (/src/widgets) — Blueprint-style UI widgets and themes.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Nothing in the client requires this: before it exists the designer saves
-- to localStorage and says so; the game keeps the last live set it cached.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.ui_widgets — one row per widget/theme document (`data` is the whole
--  document, see widgets.format.js). A document, not a ledger.
--
--  LIVE is the whole point: a live row is applied to EVERY player's game
--  (a widget mounted into a slot or onto a selector, a theme's CSS). So:
--   • anyone signed in may read live rows (they have to, to render them);
--   • the owner reads/writes their own rows;
--   • ONLY public.is_admin() may set live = true (trigger). A non-admin who
--     tries gets an error, not a silent no-op, so the client can say why.
--     Without this gate any player could rewrite the UI for everyone.
--  public.is_admin() already exists (api.sql / sql/021) and reads the
--  verified top-level JWT email against the admin list.
-- ============================================================================

begin;

create table if not exists public.ui_widgets (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  name        text not null default 'Untitled widget',
  kind        text not null default 'widget',
  target      jsonb not null default '{}'::jsonb,
  data        jsonb not null,
  live        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ui_widgets_id_chk   check (id ~ '^[A-Za-z0-9_-]{4,64}$'),
  constraint ui_widgets_name_chk check (char_length(name) between 1 and 80),
  constraint ui_widgets_kind_chk check (kind in ('widget', 'theme')),
  constraint ui_widgets_size_chk check (pg_column_size(data) <= 1048576)
);

create index if not exists ui_widgets_owner_idx on public.ui_widgets (owner_id, updated_at desc);
create index if not exists ui_widgets_live_idx  on public.ui_widgets (updated_at desc) where live;

-- updated_at is server-owned; going live is admin-owned.
create or replace function public.ui_widgets_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.created_at := coalesce(old.created_at, new.created_at);
  if new.live and (tg_op = 'INSERT' or not coalesce(old.live, false)) then
    if not public.is_admin() then
      raise exception 'only an admin can set a widget live (it changes the UI for every player)' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ui_widgets_guard on public.ui_widgets;
create trigger ui_widgets_guard before insert or update on public.ui_widgets
  for each row execute function public.ui_widgets_guard();

-- ── RLS — the entire security boundary. Review every line. ────────────────
alter table public.ui_widgets enable row level security;

drop policy if exists ui_widgets_select on public.ui_widgets;
create policy ui_widgets_select on public.ui_widgets for select
  to authenticated
  using (owner_id = auth.uid() or live);

drop policy if exists ui_widgets_insert on public.ui_widgets;
create policy ui_widgets_insert on public.ui_widgets for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists ui_widgets_update on public.ui_widgets;
create policy ui_widgets_update on public.ui_widgets for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists ui_widgets_delete on public.ui_widgets;
create policy ui_widgets_delete on public.ui_widgets for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.ui_widgets to authenticated;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'table exists' as check_name,
       case when to_regclass('public.ui_widgets') is not null then 'ok' else 'MISSING' end as result
union all
select 'rls enabled',
       case when rowsecurity then 'ok' else 'RLS OFF' end
  from pg_tables where schemaname = 'public' and tablename = 'ui_widgets'
union all
select 'four policies',
       case when count(*) = 4 then 'ok' else 'EXPECTED 4, GOT ' || count(*) end
  from pg_policies where schemaname = 'public' and tablename = 'ui_widgets'
union all
select 'no policy without an owner check',
       case when count(*) = 0 then 'ok' else count(*) || ' policy(ies) lack auth.uid()' end
  from pg_policies where schemaname = 'public' and tablename = 'ui_widgets'
   and coalesce(qual, '') not like '%auth.uid()%' and coalesce(with_check, '') not like '%auth.uid()%'
union all
select 'guard trigger (touch + admin-only live)',
       case when count(*) = 1 then 'ok' else 'MISSING' end
  from pg_trigger where tgname = 'ui_widgets_guard' and not tgisinternal
union all
select 'is_admin() present',
       case when to_regprocedure('public.is_admin()') is not null then 'ok' else 'MISSING — apply api.sql / sql/021 first' end;
