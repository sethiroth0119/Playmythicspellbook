# Not in this snapshot

This branch is a snapshot of the live tree with the heavy binaries left out,
because the full tree is 4718.1 MB and GitHub takes neither a >100 MB file
nor a multi-GB push. Everything below still exists in the working repo on the
build machine; nothing was deleted.

| path | files | size |
| --- | --- | --- |
| `.gauntlet/sprites/…` | 314 | 261.0 MB |
| `_pending_audio/…` | 1 | 36.6 MB |
| `public/assets/…` | 4492 | 4231.9 MB |
| `tmp/…` | 6 | 0.2 MB |

Total left out: **4813 files, 4529.6 MB**. Kept: 2532 files, 188.5 MB.

## The ten largest

- 179.0 MB — `.gauntlet/sprites/sprites-2026-09-05/r4/battle-screen-perf/trace-base.json`
- 39.6 MB — `public/assets/Ausslte/Mythic Spellbook spells.zip`
- 38.4 MB — `public/assets/3d models/Vendor.zip`
- 36.6 MB — `_pending_audio/battle music.wav`
- 35.4 MB — `public/assets/background/Backgrounds/websitefloodvideo.mp4`
- 31.5 MB — `public/assets/Spells/spell/New spells.zip`
- 27.3 MB — `.gauntlet/sprites/sprites-2026-09-05/r4/battle-screen-perf/trace-flip3.json`
- 27.0 MB — `.gauntlet/sprites/sprites-2026-09-05/r4/battle-screen-perf/trace-flip2.json`
- 25.8 MB — `.gauntlet/sprites/sprites-2026-09-05/r4/battle-screen-perf/trace-flip.json`
- 24.1 MB — `public/assets/Units/unit frames/Mythic Spellbook units/Last units/Bonus units/Newunits/card updates/elementals/giants/Overframes/bugs and bunny/Revealing Realms.zip`

## What this snapshot is

Live build **v194**, taken from commit `329030f39967b85cbba7a7c49c9b1e9dd69ae9da`.
It is a single parentless commit: the real history carries the 179 MB trace
above and cannot be pushed until that is stripped, which rewrites every
commit hash and has not been authorised.
