# ☁ Card Art — cloud hosting (the library lives in Supabase, not the client)

**The problem this solves:** card art used to live entirely in the browser
(IndexedDB + memory) and was backed up to Supabase as one giant `cardArt.json`
(100MB+). To show any art the client had to hold the *whole* library — which
caused the GPU/native-memory crashes and forced "placeholder mode."

**The fix (Phase 1, live):** each card art is uploaded as its **own image file**
to a **public** Supabase Storage bucket, and the card stores just the public CDN
URL (`card.artUrl`). The browser + CDN load and cache each image **on demand** —
the client holds **zero art bytes**. The URL travels with the card, so it
publishes to every player for free.

## One-time setup (Supabase Dashboard → Storage)

1. **Create a new bucket**
   - Name: `card-art`
   - **Public bucket: ON**

2. **Add write policies** (so a signed-in user can only write their own folder —
   reads are public, no read policy needed). Run in the SQL editor:

```sql
create policy "card-art write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-art' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "card-art update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'card-art' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "card-art delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-art' and (storage.foldername(name))[1] = auth.uid()::text);
```

That's it. Until the bucket exists, the Forge **Upload** button falls back to
saving art locally (legacy behavior) and toasts the reason.

## How it works

- Forge **Upload** → resize to 512px → `cloudUploadCardArtFile(cardId, dataURL)`
  uploads to `card-art/<userId>/<cardId>.<ext>` (upsert) → stores the public URL
  on `card.artUrl` + `Forge.cardArtUrl[cardId]`, and **drops the local base64**.
- Forge **Use URL** with an `http(s)` link stores it directly (external host);
  a `data:` URL is uploaded to the bucket for you.
- `getCardArt(cardId)` returns `Forge.cardArtUrl[cardId]` first (hydrated from the
  card's synced/published `artUrl`), before any IDB/streaming path.

## Next phases (not yet built)

- **Migrate the existing library:** a "Move my art to the cloud" admin button that
  uploads every existing `Forge.cardArt[id]` base64 to the bucket, sets
  `card.artUrl`, and clears the local copies — freeing the current client bloat.
- **Sprites + location/pack art:** the same per-image model for the other heavy
  asset categories.
