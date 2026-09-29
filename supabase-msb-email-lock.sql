-- ============================================================
-- Mythic Spellbook — LOCK DOWN email profile lookups
-- Run ONCE in the GAME Supabase project (ktsiasyjusesawtrwrjc) → SQL Editor.
-- Run this AFTER you've added GAME_SERVICE_KEY to the Codex worker (otherwise
-- the auto-match falls back to the old public path until you do).
--
-- After this, msb_profile_by_email can ONLY be called with the service key
-- (i.e. from the Codex server, which verifies the signed-in Codex user first).
-- The public anon key can no longer enumerate emails.
-- ============================================================

revoke execute on function public.msb_profile_by_email(text) from public, anon, authenticated;
grant  execute on function public.msb_profile_by_email(text) to service_role;
