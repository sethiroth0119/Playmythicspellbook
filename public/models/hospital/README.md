# Hospital models

`patients/` — the walk-in patients. Drop `.glb` files here and list them in
`/public/src/hospital/patients.models.js`; patients pick one at random on
arrival and keep it. Human-scale is normalised on load (the scene measures the
mesh and scales to 1.75 m), so export units do not matter. A `walk` clip is
used while they cross the lobby; they lie still in bed.

Beds are NOT models here — they come from the decoration market
(`furniture_catalog`, `func = 'bed'`), the same catalogue the Card Shop and the
Dwelling buy from, plus the built-in Ward Cot.

Keep every file under Cloudflare's per-asset cap (see `/public/models/README.md`
and `_glbpack.mjs`).
