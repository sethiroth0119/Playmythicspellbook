# Hospital models

`patients/` — the walk-in patients. Drop `.glb` files here and list them in
`/public/src/hospital/patients.models.js`; patients pick one at random on
arrival and keep it. Human-scale is normalised on load (the scene measures the
mesh and scales to 1.75 m), so export units do not matter. A `walk` clip is
used while they cross the lobby; they lie still in bed.

Catalogue beds come from the decoration market (`furniture_catalog`,
`func = 'bed'`), the same catalogue the Card Shop and the Dwelling buy from.
The built-in Ward Cot IS a model here: `ward-bed.glb`, packed by
`tools/pack-glb.mjs --bed`, whose sidecar `ward-bed.json` records the measured
mattress height and headboard end; `/public/src/hospital/beds.js` `BED_MODEL`
pins itself to those numbers (the patient lies at the measured mattress, head
on the pillow) and `_hospital_smoke.mjs` checks they agree.

`ward-desk.glb` — the Ward Bay's counter (`floor.js` `BAY_MODEL`), a second
Meshy export packed the same way as the intake desk.

`crate-intake.glb`, `containment-vault.glb`, `supply-bench.glb`,
`dispensary-stockroom.glb` — the Crate Intake, Containment Vault, Supply Bench
and Dispensary Stockroom (`floor.js` `WARD_MODEL` / `VAULT_MODEL` /
`SUPPLY_MODEL` / `STOCK_MODEL`). Any station with a `model` in `floor.js` is
swapped in by `scene.desk.js`, sized from its sidecar, and checked by the
smoke's generic loop — adding another is one data entry plus one pack.

`compounding-lab.glb`, `loading-dock.glb` — the Compounding Lab
(`COMPOUND_MODEL`, the hot station) and the Loading Dock (`DOCK_MODEL`).

`intake-desk.glb` — the Front Desk counter. Packed from a 115 MB / 2.99 M-triangle
Meshy export by `tools/build-intake-desk.mjs` (source: the byte-verified master
in `assets-source/glb-masters/hospital/`). The script also writes
`intake-desk.json` — the packed file's measured extents — and
`/public/src/hospital/floor.js` `DESK_MODEL.raw` must match it, because the
walker's collider is sized from `raw`; `_hospital_smoke.mjs` checks that they
agree. Re-export from Meshy → copy to the masters folder → re-run the script →
update `raw` if the extents changed. `scene.desk.js` swaps it in over the
builder's box at runtime.

Keep every file under Cloudflare's per-asset cap (see `/public/models/README.md`
and `tools/build-intake-desk.mjs` / `tools/build-forklift.mjs` for the recipe).
