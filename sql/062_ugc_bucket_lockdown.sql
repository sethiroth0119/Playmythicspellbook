-- ════════════════════════════════════════════════════════════════════════════
-- 062 · UGC BUCKET LOCKDOWN — three public upload doors that are open today
--
-- 🔴 RUN THIS BEFORE 063. It is not part of the van-livery feature; it is the
--    reason the van-livery feature has to be built the careful way, and it is
--    live right now.
--
-- CLAUDE.md says, and has said since the community design was written:
--     "No image or video upload. Text only. Hosting UGC carries a
--      non-deferrable legal obligation to detect and report CSAM."
--
-- The storage layer does not currently agree with that sentence. Audited
-- 2026-08-26 against project ktsiasyjusesawtrwrjc:
--
--   1. 🔴 card-art — policy "card-art all", command ALL, roles NULL.
--      A NULL role list means PUBLIC: the policy applies to `anon` as well as
--      `authenticated`. The bucket is public:true. The anon key ships inside
--      wrangler.jsonc and inside every copy of index.html. So ANY person on the
--      internet — no account, no sign-in — can PUT an arbitrary file into a
--      bucket this game serves publicly, and can also overwrite or DELETE every
--      piece of card art already in it. This is both the CSAM exposure and a
--      one-line-of-JavaScript vandalism hole.
--
--   2. 🟠 feed-media — authenticated players may INSERT under their own uid and
--      the bucket is publicly readable. No code in public/ references this
--      bucket at all, so it is an open door with nothing behind it: all risk,
--      no feature. It is revoked here.
--
--   3. 🟠 battle-clips — authenticated players may INSERT (video/webm, video/mp4,
--      50 MB) and the bucket is publicly readable. Unlike the other two this IS
--      wired up: openShareToBroadcast() in index.html uploads a recorded clip
--      when a player shares a battle. That is player-uploaded VIDEO on public
--      URLs with no scanning of any kind.
--      ⚠ SECTION 3 IS THE ONE THAT CHANGES PLAYER-VISIBLE BEHAVIOUR and it is
--        left COMMENTED OUT deliberately — turning it on breaks clip sharing for
--        everyone until that feature is either retired or routed through the
--        same review pipeline 063 builds. That is a product call, not a call to
--        make inside a migration. Read section 3 and decide.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A shared admin test ─────────────────────────────────────────────────────
-- ⚠ eb_is_admin() already exists but admits exactly ONE address
--   (richaegisop@gmail.com). The owner account play@mythicsoa.com is NOT in it,
--   so reusing it here would lock the owner out of their own art bucket and,
--   in 063, out of the review queue. This helper mirrors ADMIN_EMAILS in
--   index.html instead. SECURITY DEFINER + a pinned search_path: it is called
--   from inside storage policies and must not be shadowable.
create or replace function public.ms_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    'richaegisop@gmail.com',
    'play@mythicsoa.com',
    'dev@mythicspellbook.com'
  );
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. card-art — close the anonymous write hole
-- ════════════════════════════════════════════════════════════════════════════
-- Reads stay public: card art is referenced by public URL from every client and
-- from the public catalog, so removing public SELECT would blank the game's art.
-- Writes become admin-only, which matches the only path that actually produces
-- them — the Forge, which index.html already gates behind adminClick().
drop policy if exists "card-art all"            on storage.objects;
drop policy if exists card_art_public_read      on storage.objects;
drop policy if exists card_art_admin_write      on storage.objects;
drop policy if exists card_art_admin_update     on storage.objects;
drop policy if exists card_art_admin_delete     on storage.objects;

create policy card_art_public_read on storage.objects
  for select using (bucket_id = 'card-art');

create policy card_art_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-art' and public.ms_is_admin());

create policy card_art_admin_update on storage.objects
  for update to authenticated
  using       (bucket_id = 'card-art' and public.ms_is_admin())
  with check  (bucket_id = 'card-art' and public.ms_is_admin());

create policy card_art_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-art' and public.ms_is_admin());

-- A size and type ceiling, so even an admin slip cannot park a 2 GB video here.
update storage.buckets
   set file_size_limit   = 26214400,   -- 25 MB
       allowed_mime_types = array['image/png','image/jpeg','image/webp',
                                  'image/gif','image/avif',
                                  'audio/mpeg','audio/wav','audio/ogg']
 where id = 'card-art';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. feed-media — an open door with nothing behind it
-- ════════════════════════════════════════════════════════════════════════════
-- Nothing in public/ writes to this bucket. Player INSERT is revoked; reads are
-- left alone so anything already stored keeps resolving rather than 404-ing
-- somewhere unexpected. Re-grant it deliberately, through 063's pipeline, if a
-- feed image feature is ever actually wanted.
drop policy if exists feed_media_own_insert  on storage.objects;
drop policy if exists feed_media_admin_write on storage.objects;

create policy feed_media_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feed-media' and public.ms_is_admin());

-- ════════════════════════════════════════════════════════════════════════════
-- 3. battle-clips — player-uploaded VIDEO on public URLs  ⚠ DECIDE, DO NOT RUN BLIND
-- ════════════════════════════════════════════════════════════════════════════
-- This is a real, shipped feature: "Share to Broadcast" records a battle clip
-- and uploads it. It is also the largest UGC surface in the game (50 MB of
-- arbitrary video per object, publicly readable, never scanned).
--
-- Three options, in the order I would take them:
--
--   (a) ROUTE IT THROUGH THE PIPELINE. Video moderation is a separate and more
--       expensive product tier than still images at every provider. Costs more,
--       keeps the feature.
--   (b) TURN THE FEATURE OFF and keep sharing text + an external link (players
--       already may paste a clip URL — that hosts nothing here and carries no
--       scanning duty, because the host that serves it carries it instead).
--   (c) MAKE THE BUCKET PRIVATE. Uncomment below. This stops public
--       distribution immediately without deleting anyone's data — but every
--       already-shared clip link goes dead, because the public URL stops
--       resolving. Do NOT run this without expecting that.
--
-- Doing nothing is the only option that is not a decision, and it is the one
-- that leaves an unscanned public video host attached to the game.
--
-- update storage.buckets set public = false where id = 'battle-clips';
-- drop policy if exists battle_clips_public_read on storage.objects;
-- create policy battle_clips_owner_read on storage.objects
--   for select to authenticated
--   using (bucket_id = 'battle-clips'
--          and ((storage.foldername(name))[1] = auth.uid()::text
--               or public.ms_is_admin()));

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — every row here should read the way the comment above it says.
-- ════════════════════════════════════════════════════════════════════════════
select b.id                                   as bucket,
       b.public                               as publicly_readable,
       b.file_size_limit,
       p.polname                              as policy,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                     when 'w' then 'UPDATE'  when 'd' then 'DELETE'
                     else 'ALL' end           as cmd,
       coalesce((select string_agg(rolname, ',') from pg_roles
                  where oid = any(p.polroles)), 'PUBLIC (incl. anon)') as applies_to
  from storage.buckets b
  left join pg_policy p
    on p.polrelid = 'storage.objects'::regclass
   and (pg_get_expr(p.polqual, p.polrelid) like '%' || b.id || '%'
     or pg_get_expr(p.polwithcheck, p.polrelid) like '%' || b.id || '%')
 where b.id in ('card-art','feed-media','battle-clips')
 order by b.id, cmd;
-- ✅ Expected after running sections 1 and 2:
--    card-art     → SELECT applies to PUBLIC; INSERT/UPDATE/DELETE authenticated only
--    feed-media   → INSERT authenticated only (admin-checked)
--    battle-clips → unchanged, because section 3 is a decision you have not made yet
