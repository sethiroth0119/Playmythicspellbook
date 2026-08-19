/* ════════════════════════════════════════════════════════════════════════════
   🪜 THE BAND LADDER — what each grade of land will actually take.
   ----------------------------------------------------------------------------
   The brief's own example is the spec:

     "Land Value $850/m² might attract luxury apartments, corporate
      headquarters, banks, high-end card shops, hotels, auction houses.
      Land Value $90/m² might attract warehouses, discount retailers,
      factories, small businesses, starter housing."

   🔴 AND THAT IS WHERE THE FIRST HONEST CUT IS. node-city has no hotel, no
      auction house, no bank building and no corporate headquarters. Writing
      those into a tenant table would be the exact failure this project has
      already paid for twice — "a progression tree advertised building unlocks
      that nothing checked". EVERY id below is a live `BUILDINGS` key, and
      `compile()` drops any that is not, the same way /src/zoning validates its
      mixes. A band whose set empties is a band that develops nothing, and the
      panel says so rather than pretending.

   So the brief's ladder is delivered in the buildings this city HAS. The shape
   survives the translation intact:

     Prime        Club · Restaurant · Player Shop · Duel Arena · Stadium ·
                  Index Fund · Holding Company            ← the destination end
     Marginal     Mine · Quarry · Lumber Camp · Fuel Rig · Warehouse · Depot ·
                  Food Truck · Gas Station                ← the cheap-land end

   ── HOW A SET IS USED, AND THE ONE THING IT ENFORCES ──────────────────────
   /src/zoning's `typeFor()` is the single point in the game where "what goes on
   this plot" is decided. It picks deterministically out of the zone's mix. One
   guarded call filters that bag through `admits()`, so LAND VALUE DECIDES WHICH
   TENANT A ZONED LOT ATTRACTS — which is the whole feature. If the filter
   empties the bag the plot is skipped as `nomix` and the development run
   reports it, because "you zoned 200 card stores into land that will take 30"
   has to be visible as vacancy, not silently downgraded into something else.

   ── RESIDENTIAL IS ADVISORY, AND THAT IS SAID OUT LOUD ────────────────────
   node-city has exactly ONE residential building (`housing`); the grades a
   player perceives are /src/zoning's zone ids, which carry the archetype and
   the level target. So `grades` below is the residential half of the ladder —
   and it is published as ADVICE, not as a rule. Nothing refuses a paint.
   Enforcing it would mean changing who moves in, which is /src/demographics'
   growth model and a different decision than this one; making the claim
   without enforcing it is the failure named above. It is labelled advisory in
   the API, in the panel and here, and it is the next agent's to enforce or to
   drop.
   ════════════════════════════════════════════════════════════════════════════ */

import { LV } from './tuning.js';

/* The five rungs. `id` is stable and is what a consumer should key on; `i` is
   the index and is what the colour ramp and the histogram use. */
export const BANDS = [
  { i: 0, id: 'marginal', ico: '🌾', name: 'Marginal',
    blurb: 'Bare land with a road on it. Extraction, storage and whatever needs space more than it needs customers.' },
  { i: 1, id: 'modest', ico: '🏚', name: 'Modest',
    blurb: 'A street, a few neighbours, nothing to walk to. Cheap frontage — the sheds, the yards and the corner shop.' },
  { i: 2, id: 'established', ico: '🏘', name: 'Established',
    blurb: 'A working neighbourhood. Everyday retail and light making; the first land that a business chooses rather than settles for.' },
  { i: 3, id: 'premium', ico: '🏙', name: 'Premium',
    blurb: 'Amenity, footfall and money nearby. Restaurants, finance and the businesses that can pay to be seen.' },
  { i: 4, id: 'prime', ico: '💎', name: 'Prime',
    blurb: 'The best land the city has made. Nightlife, destinations and headquarters — and nothing that needs a loading bay.' },
];

export const BAND_BY_ID = Object.fromEntries(BANDS.map(b => [b.id, b]));

/* ── THE TENANT TABLE ───────────────────────────────────────────────────────
   Per band, per zone category. Read DOWN a column to see a business type climb
   its ladder; read ACROSS a row to see what one grade of land will take.

   ⚠ INDUSTRY IS BOUNDED AT BOTH ENDS AND THAT IS THE POINT. `ind` is empty at
     `prime`: a smelter does not outbid a club for the best corner in the city,
     and modelling that as "industry can go anywhere, it just would not" is the
     same as not modelling it. It is also one of the four brakes on the feedback
     loop (see field.js): land that rises far enough LOSES tenants, so a
     district cannot intensify for ever and a city cannot become all one thing.
   ⚠ `off` is empty at `marginal` for the same reason in the other direction.
     An empty set is a real answer — the plot stays vacant and is reported.

   Everything here is a live BUILDINGS id or it is dropped at compile time. */
export const TENANTS = {
  marginal: {
    com: ['foodtruck', 'gasstation'],
    off: [],
    ind: ['scrapmine', 'quarry', 'lumbercamp', 'fibercroft', 'fuelrig', 'warehouse', 'depot'],
    res: ['housing'],
  },
  modest: {
    com: ['foodtruck', 'gasstation', 'grocery', 'retail'],
    off: ['reslab'],
    ind: ['warehouse', 'depot', 'motorpool', 'sawmill', 'weavery', 'cannery', 'farm', 'railyard'],
    res: ['housing'],
  },
  established: {
    com: ['grocery', 'retail', 'shop', 'restaurant'],
    off: ['reslab', 'forge'],
    ind: ['smelter', 'cannery', 'machineshop', 'papermill', 'printworks', 'weavery', 'motorpool'],
    res: ['housing'],
  },
  premium: {
    com: ['restaurant', 'shop', 'retail', 'club'],
    off: ['forge', 'indexfund'],
    ind: ['machineshop', 'printworks', 'munitions'],
    res: ['housing'],
  },
  prime: {
    com: ['club', 'restaurant', 'shop', 'arena', 'stadium'],
    off: ['indexfund', 'holdco'],
    ind: [],
    res: ['housing'],
  },
};

/* ── THE RESIDENTIAL HALF — ADVISORY. See the header. ──────────────────────
   /src/zoning's ids. Validated against the live zone catalogue at compile time
   for the same reason the buildings are: a zone id that is retired must drop
   out rather than be recommended. */
export const GRADES = {
  marginal:    ['r_rent', 'r_low'],
  modest:      ['r_low', 'r_row', 'r_rent'],
  established: ['r_row', 'r_apt', 'r_mixed'],
  premium:     ['r_apt', 'r_mixed', 'r_high'],
  prime:       ['r_high', 'r_mixed'],
};

/* ── BAND FROM PREMIUM ──────────────────────────────────────────────────────
   `t` is premium / premiumFull, clamped to 0..1 by the caller. The cuts are in
   tuning.js and the derivation of each one is written there. */
export function bandIndex(t) {
  const c = LV.bandCuts;
  for (let i = 0; i < c.length; i++) if (t < c[i]) return i;
  return c.length;
}

/* The full premium this ladder is measured against — the sum of every cap,
   which is what the model can actually produce on one tile. Computed here from
   the tuning table rather than written down, so adding a term to field.js and
   forgetting to re-anchor the ladder is not a thing that can happen. */
export function premiumFull() {
  return LV.stencilRef + LV.reach.cap + LV.wealth.cap + LV.transit.cap + LV.water.cap;
}

/* ── COMPILE ────────────────────────────────────────────────────────────────
   Validate every id against what is REALLY in the game, once, at mount.
     · a BUILDINGS id that does not exist is dropped (the /src/zoning rule);
     · a zone id /src/zoning does not know is dropped;
   and both are reported to the console ONCE, because a silently shrinking
   tenant table is a feature that quietly stops working. Nothing throws: a band
   that loses every tenant becomes a band that develops nothing, which is a
   legible state, and a crash is not.

   ⚠ PROGRESSION IS **NOT** BAKED IN HERE. `MythicProgress.buildingUnlocked()`
     is asked at CALL time, not at compile time, because the tree unlocks
     things during a session and a table compiled at boot would be a stale
     promise. See `setsFor()`. */
export function compile(BUILDINGS, zoneIds) {
  const haveB = (t) => !!(BUILDINGS && BUILDINGS[t]);
  const haveZ = zoneIds && zoneIds.length ? (z) => zoneIds.indexOf(z) >= 0 : () => true;
  const droppedB = [], droppedZ = [];
  const tenants = {}, grades = {};
  for (const b of BANDS) {
    const src = TENANTS[b.id] || {};
    const out = {};
    for (const cat of ['com', 'off', 'ind', 'res']) {
      out[cat] = (src[cat] || []).filter((t) => {
        if (haveB(t)) return true;
        if (droppedB.indexOf(t) < 0) droppedB.push(t);
        return false;
      });
    }
    tenants[b.id] = out;
    grades[b.id] = (GRADES[b.id] || []).filter((z) => {
      if (haveZ(z)) return true;
      if (droppedZ.indexOf(z) < 0) droppedZ.push(z);
      return false;
    });
  }
  if (droppedB.length) console.warn('[LandValue] tenant ids not in BUILDINGS, dropped:', droppedB.join(', '));
  if (droppedZ.length) console.warn('[LandValue] grade ids not in the zone catalogue, dropped:', droppedZ.join(', '));
  return { tenants, grades, droppedB, droppedZ };
}
