-- ============================================================
-- Mythic Spellbook — public player profiles for the Codex site
-- Run ONCE in the GAME Supabase project (ktsiasyjusesawtrwrjc)
--   → SQL Editor → New query → paste → Run.  Idempotent.
--
-- Lets any signed-in visitor view another player's PUBLIC profile
-- (name, Cinder, Aza, Mythic Token, records, units, decks) WITHOUT
-- exposing the entire user_profiles row. A player's own profile is
-- still read directly under their own RLS; this is only for viewing
-- OTHERS. Uses to_jsonb() so it works whether `records`/`units` are
-- real columns or live inside the `forge` JSONB.
-- ============================================================

create or replace function public.msb_public_profile(p_user_id uuid)
returns json
language sql
security definer
stable
set search_path = public
as $$
  with r as (
    select to_jsonb(up) as j, up.user_id as uid
    from public.user_profiles up
    where up.user_id = p_user_id
  )
  select json_build_object(
    'user_id',      r.j->'user_id',
    'display_name', r.j->'display_name',
    'gems',         r.j->'gems',
    'sovereigns',   r.j->'sovereigns',
    'records',      coalesce(r.j->'records', r.j->'forge'->'records'),
    'units',        coalesce(r.j->'units',   r.j->'forge'->'units'),
    'forge',        json_build_object('userDecks',
                       coalesce(r.j->'forge'->'userDecks', r.j->'decks', '[]'::jsonb)),
    'mt',           coalesce((select mb.mt from public.mythic_balances mb where mb.user_id = r.uid), 0)
  )
  from r;
$$;

grant execute on function public.msb_public_profile(uuid) to anon, authenticated;

-- Optional: name search that doesn't depend on user_profiles' own SELECT policy.
create or replace function public.msb_search_players(p_q text)
returns table(user_id uuid, display_name text)
language sql
security definer
stable
set search_path = public
as $$
  select up.user_id, up.display_name
  from public.user_profiles up
  where up.display_name ilike '%' || coalesce(p_q, '') || '%'
    and coalesce(up.display_name, '') <> ''
  order by up.display_name
  limit 20;
$$;

grant execute on function public.msb_search_players(text) to anon, authenticated;
