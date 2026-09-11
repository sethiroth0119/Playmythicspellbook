-- 041 — Athena Widgets: page documents (the ✎ Edit UI live editor, round 14).
-- A "page" row holds selector rules (text / style / hide) for one screen of
-- the game, applied to every player once live. Same table, same RLS, same
-- admin-only live trigger as widgets and themes (sql/040) — this file only
-- widens the kind check. Idempotent; re-runnable.
begin;

alter table public.ui_widgets drop constraint if exists ui_widgets_kind_chk;
alter table public.ui_widgets add constraint ui_widgets_kind_chk check (kind in ('widget', 'theme', 'page'));

commit;

-- verify: expect one row whose definition lists 'page'
select conname, pg_get_constraintdef(oid) as def
from pg_constraint where conrelid = 'public.ui_widgets'::regclass and conname = 'ui_widgets_kind_chk';
