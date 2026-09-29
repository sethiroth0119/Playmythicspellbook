-- =====================================================================
-- MIGRATION 012 - world chat derives the sender name. Run after 011.
-- Plain ASCII. Idempotent. NO client deploy needed - the signature is
-- unchanged, so every existing build gets the fix immediately.
-- =====================================================================

-- ===========================================================================
-- 012 - WORLD CHAT DERIVES THE SENDER NAME TOO
--
-- v120g0 moved world chat behind chat_send() and fixed the filter and the rate
-- limit. It did NOT fix identity: chat_send still takes p_sender_name FROM THE
-- CALLER and stores it verbatim. Anyone with devtools can post in world chat,
-- trade chat, or a DM under any name they like.
--
-- sql/011 closed exactly this on the Guild Wire. This closes it on the larger
-- surface.
--
-- ! THE SIGNATURE IS DELIBERATELY UNCHANGED. p_sender_name stays in the
--   parameter list and is simply IGNORED. Dropping it would break every client
--   still calling with four arguments - PostgREST resolves by argument
--   signature, so an old build would start getting PGRST202 and world chat
--   would go silent for anyone who had not reloaded. Ignoring the value gives
--   every existing client the fix immediately, with no deploy and no
--   coordination.
--
-- Idempotent. Plain ASCII. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
-- ===========================================================================

create or replace function public.chat_send(
  p_room text, p_body text, p_sender_name text default null,
  p_recipient_id uuid default null)
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text;
  v_name text;
  v_last timestamptz;
  r public.chat_messages;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'empty message'; end if;
  if length(v_body) > 500 then v_body := left(v_body, 500); end if;

  -- RATE LIMIT, server side (unchanged from v120g0).
  select max(created_at) into v_last
    from chat_messages where sender_id = v_uid;
  if v_last is not null and now() - v_last < interval '1500 milliseconds' then
    raise exception 'slow down';
  end if;

  -- FILTER, server side (unchanged from v120g0).
  v_body := chat_clean(v_body);

  -- ! IDENTITY IS NOW DERIVED, NOT ACCEPTED. p_sender_name is ignored on
  --   purpose - see the signature note at the top of this file.
  select nullif(btrim(coalesce(display_name, '')), '')
    into v_name from user_profiles where user_id = v_uid;
  v_name := left(coalesce(v_name, 'Survivor'), 40);

  insert into chat_messages (room, sender_id, sender_name, recipient_id, body)
  values (p_room, v_uid, v_name, p_recipient_id, v_body)
  returning * into r;
  return r;
end $$;

revoke all on function public.chat_send(text, text, text, uuid) from public, anon;
grant execute on function public.chat_send(text, text, text, uuid) to authenticated;


-- --- VERIFY ---------------------------------------------------------------
-- Expect has_rpc 1, insert_policies 0 (the direct path stayed closed), and
-- ignores_name true.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'chat_send')               as has_rpc,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages'
      and cmd = 'INSERT')                                                 as insert_policies,
  (select pg_get_functiondef(p.oid) not like '%values (p_room, v_uid, p_sender_name%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'chat_send' limit 1)       as ignores_name;
