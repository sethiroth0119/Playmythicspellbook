-- CHAT: make the server the only thing that can post.
-- Plain ASCII (a console mangles box-drawing before you paste it).
-- Idempotent. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
--
-- WHY THIS IS FIRST
-- Verified in the live client, not taken on faith:
--   line 172813  if (Date.now() - Chat._lastSendAt < CHAT_SEND_COOLDOWN) return;
--   line 172814  const text = _chatClean(body);
--   line 172839  await Cloud.client.from('chat_messages').insert(rowOut)
-- The rate limit and the profanity filter are both JavaScript, and the insert
-- that follows is direct. Anyone with devtools can call that insert with
-- unfiltered text as fast as they like. Both controls are decoration today.
--
-- This moves them into the database and makes the RPC the ONLY write path.
-- Do not re-implement any of it in JS afterwards; the client keeps its copies
-- purely as instant feedback, never as enforcement.

-- 1. server-side profanity mask ------------------------------------------
-- Deliberately small and readable. Extend the array; do not extend the JS.
create or replace function public.chat_clean(p text)
returns text language plpgsql immutable as $$
declare w text; out text := coalesce(p, '');
begin
  foreach w in array array[
    'fuck','shit','bitch','cunt','nigger','faggot','retard','whore','rape'
  ] loop
    out := regexp_replace(out, '(?i)' || w, repeat('*', length(w)), 'g');
  end loop;
  return out;
end $$;

-- 2. the only insert path -------------------------------------------------
create or replace function public.chat_send(
  p_room text, p_body text, p_sender_name text default null,
  p_recipient_id uuid default null)
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_body text;
  v_last timestamptz;
  r public.chat_messages;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'empty message'; end if;
  if length(v_body) > 500 then v_body := left(v_body, 500); end if;

  -- RATE LIMIT, server side. 1.5s to match the client's optimistic gate.
  select max(created_at) into v_last
    from chat_messages where sender_id = v_uid;
  if v_last is not null and now() - v_last < interval '1500 milliseconds' then
    raise exception 'slow down';
  end if;

  -- FILTER, server side.
  v_body := chat_clean(v_body);

  insert into chat_messages (room, sender_id, sender_name, recipient_id, body)
  values (p_room, v_uid, p_sender_name, p_recipient_id, v_body)
  returning * into r;
  return r;
end $$;

-- 3. close the direct path ------------------------------------------------
-- With the insert policy dropped and no replacement, RLS refuses every direct
-- INSERT. chat_send is SECURITY DEFINER so it still writes. Reads are
-- untouched, so nothing about displaying chat changes.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'chat_messages' and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.chat_messages', p.policyname);
  end loop;
end $$;

revoke insert on public.chat_messages from anon, authenticated;

revoke all on function public.chat_send(text,text,text,uuid) from public, anon;
grant execute on function public.chat_send(text,text,text,uuid) to authenticated;
grant execute on function public.chat_clean(text) to authenticated;

-- 4. verify ---------------------------------------------------------------
-- Expect: has_rpc 1, insert_policies 0
select
  (select count(*) from pg_proc where proname = 'chat_send')          as has_rpc,
  (select count(*) from pg_policies
    where tablename = 'chat_messages' and cmd = 'INSERT')             as insert_policies;
