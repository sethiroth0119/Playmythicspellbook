-- ============================================================================
-- battle-clips — public Storage bucket for auto-recorded gameplay clips.
-- Run once in the Supabase SQL editor. Idempotent.
-- Players upload to <their-uid>/<timestamp>.webm ; everyone can watch.
-- ============================================================================

-- 1) Create (or update) the bucket — public, 50 MB cap, video only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('battle-clips', 'battle-clips', true, 52428800, array['video/webm','video/mp4'])
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/webm','video/mp4'];

-- 2) Policies on storage.objects (RLS is already enabled on that table).
drop policy if exists "battle_clips_public_read"  on storage.objects;
drop policy if exists "battle_clips_own_insert"    on storage.objects;
drop policy if exists "battle_clips_own_delete"    on storage.objects;

-- Anyone can watch a clip.
create policy "battle_clips_public_read"
  on storage.objects for select
  using (bucket_id = 'battle-clips');

-- A signed-in player can upload only into their own uid folder.
create policy "battle_clips_own_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'battle-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A player can delete their own clips.
create policy "battle_clips_own_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'battle-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
