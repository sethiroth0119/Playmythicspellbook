---
name: city-dev
description: Work on the city builder — Node City (the 3D iframe), city production buildings and terroir (public/src/city), mayors and city state, dwellings and resonance houses, node tiers. Use for new buildings, resources, production chains, city UI, mayor features, or city bugs.
---

# City builder work

There are **two** city systems. Decide which one you are in before touching anything.

| | Node City (3D) | City production (module) |
|---|---|---|
| code | `public/node-city/index.html` (Three.js, 1.4 MB, iframe) | `public/src/city/*.js` (ES modules) |
| catalogs | `NODE_TYPES`, `BUILDINGS`, `BUILD_SECTIONS`, `FIN_TIERS`, `RES_META`, `CITY_STOCK` | `CITY_PRODUCTION`, `CITY_PREREQ`, `TERROIR_ECON` |
| talks to host via | `window.parent.city*()` functions (host declares them near `_openNodeCity` in index.html) + `postMessage({type:'mythic-city'})` fallback | `window.MythicCityBridge` (host) ⇄ `window.MythicCityProduction` (module) |
| offline mode | yes — `B.mode === 'standalone'`, `MOCK_CARDS` | degrades if bridge absent |
| tables | `city_state`, `city_mayor_pay`, `economy_nodes`, `node_power`, `node_payouts`; RPCs `city_*`, `node_set_main` | via bridge |

Mayor / manager state lives on the host: `CityMgr`, `tw_fetchNodeMayors`, `__mg.mayors`.
Dwellings: `public/dwelling/` (iframe, `window.MYTHIC.bridged()`); resonance houses:
`public/src/resonance/` via `MythicHouseBridge`. Node tiers: `public/src/nodes/tiers.js`
via `MythicNodeTierBridge`.

## Steps
1. **Locate.** `node tools/gamedev/map.mjs sections --grep city`, `map.mjs where cityAddRes`
   (or whichever `city*` bridge function), `map.mjs where CityMgr`. For the iframe, grep
   `public/node-city/index.html` for the catalog name.
2. **New building / resource in production:** edit `CITY_PRODUCTION` in
   `public/src/city/production.data.js`. Every cost key must be a live resource id
   (`catalog.mjs resources`), every resource needs a producer, cost rows = `maxLevel`.
   Then `node tools/gamedev/econ.mjs city` — it runs the module's own `auditCatalog()`
   with the live resource list. Zero problems or you are not done.
3. **New resource:** add to `RESOURCES` in index.html (id, name, icon, colour) and give it a
   cap (`getResourceCap`) and, if tradeable, a Cinder value (`RESOURCE_CINDER_VALUE`). Then
   step 2 so something produces it. Also `_TW_RES_KEYS` if Territory Wars should yield it.
4. **New host capability for the iframe:** add ONE `window.cityXxx = function` beside the
   others (grep `window.cityGetRes`), guarded like they are (try/catch, returns a plain
   value, never throws into the iframe). Then call it from node-city via `B.call('cityXxx')`
   or the existing pattern. Never reach for `Profile` from the iframe.
5. **Money in the city** goes through the bridge mutators (`cityAddCinders`, `citySpendCinders`
   → `addGems/spendGems`; `citySpendRes` → `spendResources`). Never write `Profile.*` from
   city code. `audit.mjs --rule cinder` catches leaks.
6. **Verify.** `node tools/gamedev/check.mjs --quick` plus `econ.mjs --check`. For the
   iframe, `node _synckcheck.mjs public/node-city/index.html` (pass the file — the default
   only checks index.html). The browser pane cannot composite, so for visual checks call
   the renderer directly or shim `requestAnimationFrame` in a throwaway copy.
7. Bump `?v=` on the iframe `src` (`node-city/index.html?v=…`) when node-city changes, or
   the service worker keeps serving the old build.
