-- ============================================================
-- Mythic Spellbook — Bug Bounties (Codex Bug Tracker → game Cinder)
-- Run ONCE in the GAME Supabase project (ktsiasyjusesawtrwrjc) → SQL Editor.
-- Idempotent.
--
-- Lets a game ADMIN (by their game-login email) credit Cinder (gems) to a
-- player's account as a reward for a filed bug. Admin-gated inside the function
-- so only trusted callers can pay out; every award is logged.
-- ============================================================

-- Audit log of all bounties paid.
create table if not exists public.bug_bounties (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      int  not null check (amount > 0),
  reason      text,
  awarded_by  text,
  awarded_at  timestamptz not null default now()
);
alter table public.bug_bounties enable row level security;
-- No table policies: reads/writes go through the SECURITY DEFINER function only.

create or replace function public.msb_award_cinder(p_user_id uuid, p_amount int, p_reason text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_new   int;
begin
  -- Only game admins may pay bounties. Keep this list in sync with the site's ADMIN_EMAILS.
  if v_email is null or v_email not in ('richaegisop@gmail.com', 'play@mythicsoa.com') then
    raise exception 'Not authorized to award bounties';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Invalid amount';
  end if;

  update public.user_profiles
     set gems = coalesce(gems, 0) + p_amount,
         updated_at = now()
   where user_id = p_user_id
   returning gems into v_new;

  if v_new is null then
    raise exception 'Player not found';
  end if;

  insert into public.bug_bounties(user_id, amount, reason, awarded_by)
  values (p_user_id, p_amount, p_reason, v_email);

  return json_build_object('ok', true, 'new_balance', v_new);
end;
$$;

grant execute on function public.msb_award_cinder(uuid, int, text) to authenticated;
