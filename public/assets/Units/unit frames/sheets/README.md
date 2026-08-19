# Sprite sheets

`grey-dragon-idle.webp` — 7680x384, **30 frames of 256x384**, single row.

Built from `assets-source/gif-masters/Grey Dragon Animate rare.gif` (1024x1536,
150 frames, 113 MB) by taking every 5th frame, scaling to 384px tall and tiling
into one strip. **113 MB -> 0.30 MB, a 99.7% cut.**

The original could never ship: it was over Cloudflare's 25 MiB per-asset cap and
sat in `.assetsignore` for exactly that reason.

## Wiring it up

The battle board already animates sheets — no new code needed. In the unit def
the host sends via `_bbUnitDefs` (`public/index.html`), set:

```js
sheet: { src: 'assets/Units/unit frames/sheets/grey-dragon-idle.webp',
         fw: 256, fh: 384, frames: 30, fps: 12 }
```

`paintSprite` reads `sheet.fw/fh/frames/fps` and advances by SOURCE-RECT offset
off the shared clock, so playback speed is identical at 30fps or 144fps.

⚠ Prefer a sheet over a `frames:[...]` array here. A 150-entry frame array is
150 separate HTTP requests and 150 decodes for one unit; the sheet is one of
each. The frames array exists for the Sprite Atelier's uploaded art, where the
frames genuinely arrive as separate images.

## Regenerating

```
ffmpeg -i "MASTER.gif" -vf "select='not(mod(n\,5))',scale=-1:384:flags=lanczos,tile=30x1" \
       -frames:v 1 -c:v libwebp -q:v 82 out.webp
```

Change `mod(n,5)` to take more or fewer frames; keep `tile=<count>x1` in sync.
