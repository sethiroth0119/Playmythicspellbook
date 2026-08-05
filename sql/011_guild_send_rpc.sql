-- ===========================================================================
-- 011 - GUILD WIRE: THE SERVER BECOMES THE ONLY THING THAT CAN POST
--
-- The world chat was hardened in v120g0 (chat_send). The Guild Wire never was,
-- and it has since become the default tab of the Community hub, appeared on the
-- public website, and had a Cinder reward attached to talking in it.
--
-- WHAT WAS ACTUALLY WRONG - verified against the live client, not assumed:
--   * the client inserted into guild_chat DIRECTLY;
--   * there was NO profanity filter of any kind, server or client;
--   * there was NO rate limit of any kind;
--   * user_name came FROM THE BROWSER. Anyone with devtools could post as
--     "Sethiroth Tha Dev" on the same surface where leadership posts
--     announcements. That is impersonation, not just a missing word filter.
--   * since sql/008, talking pays the community owner 10 Cinder per member per
--     5 hours - so an unthrottled write path is worth money.
--
-- This moves all four into the database. Do not re-implement any of it in JS
-- afterwards; the client keeps its copies purely as instant feedback.
--
-- Idempotent. Plain ASCII. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
-- ===========================================================================


-- --- 1. THE ONLY INSERT PATH ---------------------------------------------
create or replace function public.guild_send(p_corp_id uuid, p_body text)
returns public.guild_chat
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text;
  v_name text;
  v_last timestamptz;
  r public.guild_chat;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  -- MEMBERSHIP, checked here rather than trusted from the caller.
  if not exists (select 1 from corp_members m
                  where m.corp_id = p_corp_id and m.user_id = v_uid) then
    raise exception 'you are not in that corporation';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'empty message'; end if;
  if length(v_body) > 400 then v_body := left(v_body, 400); end if;

  -- RATE LIMIT, server side. Matches the world chat's 1.5s. This also closes
  -- the sql/008 economy hole: chat pays the owner, so an unthrottled wire is a
  -- faucet you can hold down.
  select max(created_at) into v_last
    from guild_chat where user_id = v_uid and corp_id = p_corp_id;
  if v_last is not null and now() - v_last < interval '1500 milliseconds' then
    raise exception 'slow down';
  end if;

  -- FILTER, server side. Reuses the same chat_clean the world chat uses, so
  -- extending the word list in ONE place covers both surfaces.
  v_body := chat_clean(v_body);

  -- ! IDENTITY IS DERIVED, NEVER ACCEPTED. This is the impersonation fix:
  --   there is no p_user_name parameter, so there is nothing to spoof.
  select nullif(btrim(coalesce(display_name, '')), '')
    into v_name from user_profiles where user_id = v_uid;
  v_name := left(coalesce(v_name, 'Survivor'), 40);

  insert into guild_chat (corp_id, user_id, user_name, body, kind)
  values (p_corp_id, v_uid, v_name, v_body, 'chat')
  returning * into r;
  return r;
end $$;


-- --- 1b. SYSTEM LINES ------------------------------------------------------
-- ! The wire's "X was hired as Officer" lines are inserted BY THE CLIENT today
--   (_guildLog). Revoking INSERT without this would silently stop them
--   appearing, which is the kind of breakage that shows up a week later as
--   "the wire stopped logging things".
--
-- ! Restricted to the corp FOUNDER, not any member. A member able to post
--   kind='sys' could forge "Vance was promoted to Officer", which is worse than
--   impersonating a chat line - system lines read as the game speaking. The
--   founder is already the one who can perform those actions for real.
create or replace function public.guild_log(p_corp_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_body text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from corporations c
                  where c.id = p_corp_id and c.founder_id = v_uid) then
    raise exception 'only the founder writes system lines';
  end if;
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return; end if;
  insert into guild_chat (corp_id, user_id, user_name, body, kind)
  values (p_corp_id, v_uid, 'System', chat_clean(left(v_body, 400)), 'sys');
end $$;


-- --- 2. CLOSE THE DIRECT PATH --------------------------------------------
-- With every INSERT policy dropped and no replacement, RLS refuses every direct
-- insert. guild_send and guild_log are SECURITY DEFINER so they still write.
-- Reads are untouched, so nothing about displaying the wire changes.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'guild_chat' and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.guild_chat', p.policyname);
  end loop;
end $$;

revoke insert on public.guild_chat from anon, authenticated;

revoke all on function public.guild_send(uuid, text) from public, anon;
revoke all on function public.guild_log(uuid, text) from public, anon;
grant execute on function public.guild_send(uuid, text) to authenticated;
grant execute on function public.guild_log(uuid, text) to authenticated;


-- --- 3. VERIFY -------------------------------------------------------------
-- Expect: has_rpc 2, insert_policies 0
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('guild_send','guild_log')) as has_rpc,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'guild_chat'
      and cmd = 'INSERT')                                             as insert_policies;
