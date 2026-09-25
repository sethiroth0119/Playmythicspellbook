-- ============================================================
-- Mythic Spellbook — match a game account by EMAIL for the Codex site
-- Run ONCE in the GAME Supabase project (ktsiasyjusesawtrwrjc) → SQL Editor.
-- Idempotent. Depends on public.msb_public_profile (from supabase-msb-public-profiles.sql).
--
-- Lets the Codex site show a player's game profile automatically when their
-- Codex login email matches their Mythic Spellbook email — no separate game
-- login needed to VIEW. Returns only the same public fields as msb_public_profile.
-- ============================================================

create or replace function public.msb_profile_by_email(p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid;
begin
  select id into v_uid
  from auth.users
  where lower(email) = lower(coalesce(p_email, ''))
  order by created_at
  limit 1;

  if v_uid is null then
    return null;
  end if;

  return public.msb_public_profile(v_uid);
end;
$$;

grant execute on function public.msb_profile_by_email(text) to anon, authenticated;
