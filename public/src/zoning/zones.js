/* ══════════════════════════════════════════════════════════════════════════
   🗺 THE ZONE CATALOGUE — what a player can zone land FOR.

   The CS2 spec (.gauntlet/BAR.md, "Zone types") asks for six residential
   grades, commercial low/high, office low/high and industry split into
   manufacturing and warehousing. That is what is below, expressed in the
   buildings this city ALREADY has — no new BUILDINGS entry is created by the
   zoning layer, because a zone is a land-use intent, not a structure.

   Every zone carries four things:
     col    the overlay colour. 🎨 THE FAMILY HUES ARE THE CONVENTIONAL ONES a
            first-time viewer already knows from every city builder ever
            shipped — GREEN residential, BLUE commercial, TEAL office, YELLOW
            industrial (rubric dimension 11). Density is expressed as VALUE
            inside the family: the lighter the green, the lower the density.
            Do not "improve" these into a designer palette; the whole point is
            that they are learned already.
     arch   which makeHousing archetype this zone builds. See seed.js for how
            that is imposed without editing makeHousing.
     lvl    the level the DEVELOP pass grows a fresh building to. This is the
            second half of the density read: a walkup at L1 is four storeys, at
            L3 it is seven. Growth is paid for at the shipped upgrade price.
     mix    weighted BUILDINGS ids. A district built from one id is a warehouse
            row; the mix is what makes a commercial street read as a street.

   ⚠ EVERY id in `mix` is validated against the live BUILDINGS table at mount
     (see index.js). An id that is retired — as `forge` nearly was — drops out
     of its mix instead of throwing, and a zone whose mix empties becomes
     marking-only rather than a broken build button.
   ══════════════════════════════════════════════════════════════════════════ */

export const CATS = {
  res: { name: 'Residential', ico: '🏠', hint: 'Houses, flats and mixed blocks. Grows the population cap.' },
  com: { name: 'Commercial',  ico: '🛒', hint: 'Shops, food and nightlife. Sells to citizens for Cinder.' },
  off: { name: 'Office',      ico: '🧠', hint: 'Clean work — research and finance. No freight, no smoke.' },
  ind: { name: 'Industrial',  ico: '🏭', hint: 'Making and moving goods. Wants road frontage, not neighbours.' },
};

/* `lvl` is a TARGET, not a requirement — develop() stops upgrading the moment
   the player cannot pay and reports how many stalled. A zone never spends
   money the player did not agree to: nothing here builds itself. */
export const ZONES = [
  // ── residential ×6 (+ the grandfather zone, below) ───────────────────────
  { id: 'r_low',   cat: 'res', ico: '🏡', name: 'Low density houses', short: 'Low',
    col: 0x8ed162, arch: 'detached', lvl: 1, mix: [['housing', 1]],
    desc: 'Detached family houses on their own plot — gardens, driveways, a hedge on the line.' },
  { id: 'r_row',   cat: 'res', ico: '🏘', name: 'Row housing', short: 'Row',
    col: 0x63bd4a, arch: 'row', lvl: 1, mix: [['housing', 1]],
    desc: 'Medium density, wall to wall. Narrow flat-fronted terraces that CLOSE a street block.' },
  { id: 'r_apt',   cat: 'res', ico: '🏢', name: 'Apartments', short: 'Apts',
    col: 0x3f9e5c, arch: 'walkup', lvl: 2, mix: [['housing', 1]],
    desc: 'Medium density walk-up blocks with balconies and a shared entrance.' },
  { id: 'r_high',  cat: 'res', ico: '🏙', name: 'High-density towers', short: 'Towers',
    col: 0x1f7a54, arch: 'walkup', lvl: 3, mix: [['housing', 1]],
    desc: 'The tallest residential the city builds — same block, grown to its full height.' },
  /* 🏬 MIXED USE answers BOTH demands, which is the whole point of it in CS2.
     Here that is literal rather than notional: the mix is mostly housing, but
     roughly one plot in four develops as retail, so the strip supplies shop
     coverage AND population from one zone. */
  { id: 'r_mixed', cat: 'res', ico: '🏬', name: 'Mixed use', short: 'Mixed',
    col: 0x4fb389, arch: 'walkup', lvl: 2,
    mix: [['housing', 5], ['grocery', 1], ['restaurant', 1], ['shop', 1]],
    desc: 'Retail at street level, flats above. Answers residential AND commercial demand at once.' },
  { id: 'r_rent',  cat: 'res', ico: '🏚', name: 'Low rent', short: 'Low rent',
    col: 0xb0cc63, arch: 'walkup', lvl: 1, mix: [['housing', 1]],
    desc: 'Large blocks of small flats — cheap, plain, and where the young and the broke actually live.' },
  /* 🕰 THE GRANDFATHER ZONE. A city built before this layer existed has houses
     whose archetype came from makeHousing's district roll, and those houses are
     a property of their plot: re-styling them on load would silently rewrite a
     street the player already knows. So an adopted residential tile gets THIS
     zone, which has NO archetype — the roll stays in charge until the player
     deliberately re-zones. See index.js afterLoad(). */
  { id: 'r_asbuilt', cat: 'res', ico: '🏠', name: 'Residential · as built', short: 'As built',
    col: 0x9cbf8e, arch: null, lvl: 1, mix: [['housing', 1]], adopted: true,
    desc: 'Land that was already built on when zoning arrived. The houses keep the look they have — re-zone to restyle them.' },

  // ── commercial ×2 ────────────────────────────────────────────────────────
  { id: 'c_low',  cat: 'com', ico: '🛒', name: 'Low density commercial', short: 'Com low',
    col: 0x63b4ee, lvl: 1,
    mix: [['grocery', 3], ['foodtruck', 2], ['shop', 2], ['restaurant', 2]],
    desc: 'Corner shops, groceries and food. The everyday high street.' },
  { id: 'c_high', cat: 'com', ico: '🌃', name: 'High density commercial', short: 'Com high',
    col: 0x2f6ecd, lvl: 2,
    mix: [['club', 2], ['restaurant', 3], ['shop', 2], ['grocery', 1]],
    desc: 'Nightlife and large-format retail — the block that is still lit at 2am.' },

  // ── office ×2 ────────────────────────────────────────────────────────────
  /* 🏢 ROUND 17 — THESE TWO NOW DEVELOP AN OFFICE. Until this round `o_low`
     built a Research Spire and `o_high` built a Cinder Trust, because node-city
     had no office building at all: a player who zoned Office park got a
     laboratory. `office` is that building (node-city BUILDINGS.office, and see
     makeOffice for why it reads as one), and it is now the MAJORITY of both
     bags — the specialists are what a district becomes when the player says so
     through /src/districts, not what generic office land defaults to. */
  { id: 'o_low',  cat: 'off', ico: '🧠', name: 'Office park', short: 'Office low',
    col: 0x3ec6b4, lvl: 1, mix: [['office', 3], ['reslab', 1]],
    desc: 'Low-rise offices with their own car parks, and the odd research spire among them. Quiet, clean, no freight on the street.' },
  { id: 'o_high', cat: 'off', ico: '📈', name: 'Office towers', short: 'Office high',
    col: 0x1c8f96, lvl: 2, mix: [['office', 3], ['forge', 2], ['indexfund', 1]],
    desc: 'The skyline. Office blocks built to their full height, with the trusts and funds that can afford the best of them.' },

  // ── industrial ×2 ────────────────────────────────────────────────────────
  { id: 'i_mfg',  cat: 'ind', ico: '🏭', name: 'Manufacturing', short: 'Mfg',
    col: 0xdcb63c, lvl: 1,
    mix: [['machineshop', 2], ['smelter', 2], ['cannery', 2], ['munitions', 1], ['sawmill', 1], ['weavery', 1]],
    desc: 'Works, shops and stacks. Turns raw material into something the city can sell.' },
  { id: 'i_ware', cat: 'ind', ico: '📦', name: 'Warehousing', short: 'Logistics',
    col: 0xb8842a, lvl: 1,
    mix: [['warehouse', 3], ['depot', 3], ['motorpool', 1]],
    desc: 'Sheds, docks and yards. Storage capacity and the road cap that comes with depots.' },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

/* Which zone an ALREADY BUILT tile would have been, used only by the
   grandfather sweep. Deliberately conservative: anything not listed stays
   unzoned, because guessing wrong paints a lie onto the overlay. */
export const ADOPT_BY_TYPE = {
  housing: 'r_asbuilt',
  grocery: 'c_low', foodtruck: 'c_low', shop: 'c_low', gasstation: 'c_low',
  restaurant: 'c_high', club: 'c_high', arena: 'c_high',
  office: 'o_low', reslab: 'o_low', forge: 'o_high', indexfund: 'o_high', holdco: 'o_high',
  machineshop: 'i_mfg', smelter: 'i_mfg', cannery: 'i_mfg', munitions: 'i_mfg',
  sawmill: 'i_mfg', weavery: 'i_mfg', fibercroft: 'i_mfg', lumbercamp: 'i_mfg',
  warehouse: 'i_ware', depot: 'i_ware', motorpool: 'i_ware', railyard: 'i_ware',
  /* ⛏ THE EXTRACTION ROUND (waterintake · deepmine · alloyworks · canecroft ·
     riftbore) IS DELIBERATELY ABSENT FROM THIS FILE — from every zone `mix`
     and from this table — and the absence is written down rather than left to
     be re-derived. Two reasons, and the second is the load-bearing one:
       · It matches the shipped extraction tiles. `scrapmine`, `quarry`,
         `fuelrig`, `farm`, `hydrofarm`, `purifier` and `siphon` are in no mix
         and in no ADOPT row either. /src/landvalue's own header names that set:
         "all of them extraction tiles a player sites by hand on the resource it
         wants". A zone mix develops land by DEMAND; a seam is not demand.
       · This table exists ONLY to grandfather cities built before zoning
         arrived. No such city can contain one of these tiles — they did not
         exist — so an entry here could never fire, and a rule that can never
         fire is indistinguishable from one that is broken. */
};
