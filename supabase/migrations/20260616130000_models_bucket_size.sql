-- ============================================================================
-- 🪣 models bucket — raise the per-file upload size limit so big .glb models
-- (statues, animated props) stop failing with "object exceeded the maximum
-- allowed size". The bucket was created with no file_size_limit, so it fell
-- back to the PROJECT-GLOBAL limit (50 MB on the free plan).
--
-- This sets the bucket ceiling to 500 MB. NOTE: a bucket's limit can never
-- exceed the project-global "Upload file size limit" (Dashboard → Storage →
-- Settings). On the free plan that global cap is 50 MB and CANNOT be raised —
-- to upload models larger than 50 MB the project must be on a paid plan and
-- the global limit raised there too. Below the global cap, this is the switch.
-- ============================================================================
update storage.buckets
   set file_size_limit = 524288000,        -- 500 MB, in bytes
       allowed_mime_types = null           -- accept any type (.glb = model/gltf-binary)
 where id = 'models';

-- Make sure the bucket exists with the generous limit on fresh projects too.
insert into storage.buckets (id, name, public, file_size_limit)
values ('models', 'models', true, 524288000)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
