/* ════════════════════════════════════════════════════════════════════════════
   🏙 DISTRICT SPECIALISATIONS — Layer 2, the one table a designer edits.
   ----------------------------------------------------------------------------
   THE BRIEF, in the user's own words:

     "Instead of painting a generic Commercial zone forever, players eventually
      SPECIALIZE districts. Commercial → Retail / Restaurants / Entertainment /
      Luxury Retail / Mythic Retail. Industrial → Manufacturing / Card
      Manufacturing / Technology / Heavy Industry / Logistics. Office →
      Corporate / Financial / Media / Technology / Gaming."

   ── WHAT A SPECIALISATION IS, AND WHAT IT IS NOT ───────────────────────────
   It is a SECOND tag on a tile that ALREADY carries a land-use zone. Layer 1
   (`c_high`, `i_mfg`, `o_low` …) stays exactly what it was and keeps working
   exactly as it does today; a tile with no specialisation is byte-for-byte the
   tile it was before this file existed. Layer 2 only ever REPLACES THE BAG
   /src/zoning picks a tenant out of, and optionally raises the level target.

   That is the whole mechanism, and it is deliberately the whole mechanism:
   /src/zoning's `typeFor()` is the single point in the game where "what goes on
   this plot" is decided, /src/landvalue already filters that bag through the
   band ladder, so handing `typeFor` a DIFFERENT BAG puts specialisation inside
   machinery that is already enforced and already tested. No second develop
   path, no second refusal, no second overlay.

   🔴 THERE IS NO LAND-VALUE THRESHOLD IN THIS FILE, AND THERE MUST NEVER BE.
      The brief says "Luxury Retail should not take on a $90 lot" and that is
      enforced — but not by a number written here. Every id in a `mix` below is
      a live BUILDINGS key that /src/landvalue's band table already places on a
      rung of the ladder. `filterMix()` drops the ids the tile's band will not
      take, and a mix that empties is a plot that stays VACANT and is reported.
      So Luxury Retail on marginal land refuses itself: the band admits
      `foodtruck` and `gasstation`, the mix holds neither, the intersection is
      empty. THE FLOOR YOU SEE IN THE PANEL IS DERIVED (`floorOf()` in
      index.js), computed at draw time from the live ladder, never typed in.
      A second threshold table would be a second opinion about the same tile —
      the exact failure /src/landvalue's own header was written to avoid.

   🔴 EVERY `mix` ID IS VALIDATED TWICE AND DROPPED, NEVER ADVERTISED.
      Once against the live BUILDINGS table (a retired id vanishes, the
      /src/zoning rule), and once against /src/landvalue's tenant table — an id
      no band anywhere admits can never develop, which is a specialisation that
      silently does nothing. `validate()` at the bottom reports both, and a spec
      that loses its whole mix is shown as unavailable with that reason rather
      than offered as a chip that does nothing.

   ── WHAT THE BRIEF ASKED FOR THAT IS NOT HERE, AND WHY ─────────────────────
   Three of the user's fifteen names are not shipped, because node-city has no
   building that could stand in them and inventing one is the failure this
   project has already paid for twice:

     ✗ Industrial → TECHNOLOGY. The city's one clean-research building is
       `reslab` (Research Spire), and /src/landvalue's tenant table lists it
       under OFFICE, not industry. So Technology ships ONCE, in the Office
       family (`o_tech`), rather than twice with one of them empty.
     ✗ Office → MEDIA. There is no studio, no press office and no broadcast
       building in BUILDINGS. /src/broadcast is a phone feed, not a structure.
       Shipping an empty chip called Media is an advertisement nothing checks.
     ✗ Office → GAMING. The buildings this would mean — `arena` (Duel Arena,
       "tactical card battles draw crowds") and `stadium` — are COMMERCIAL in
       the band table, not office. So gaming ships as 🏟 Mythic Entertainment
       in the Commercial family, where its buildings actually live.

   ── AND THE THREE THE USER CALLED THE HEADLINE ─────────────────────────────
   🃏 The Mythic zones are the point of the whole feature and they are built out
   of the Ouroboros chain this city ALREADY runs end to end:

       timber → lumber → cardStock → printedCards → boosterPacks
       lumbercamp  sawmill  PAPERMILL   PRINTWORKS    SHOP (Player Shop)

   ECO_BUILDING_MAP (node-city :22956) is the authority for that, not this file:
   `shop` founds a `cardShop` firm selling boosterPacks, `papermill` makes
   cardStock, `printworks` makes printedCards and `depot` makes the
   packagingMaterial that `boosterPacks` also needs (recipes.js :581). So
   🃏 Card Manufacturing is not a themed skin — a district of those three tiles
   builds the literal input set of a booster pack.

   ⚠ NOT ONE LINE IN THIS MODULE CROSSES THE BRIDGE. The card economy proper
     lives in the main app behind `Profile` / `Corp` / `Forge`, which are
     top-level `const` and invisible here (CLAUDE.md, the globals trap). The
     seam for the next round is `MythicDistricts.cardSeam()` — a REPORT, in the
     same shape and with the same rule as `MythicEconomy.cardOutput()`: it
     measures, it does not pay, and what the Foundation Reserve does with it
     belongs on the host's side where those bindings actually exist.
   ════════════════════════════════════════════════════════════════════════════ */

/* The three families that have specialisations. Keyed by /src/zoning's `cat`,
   which is what binds a spec to the zones it may sit on — a spec is never
   listed against a zone id, so an twelfth commercial zone added next week
   inherits the commercial specs for free. RESIDENTIAL IS ABSENT ON PURPOSE:
   the user's design lists none, /src/landvalue's residential advice is
   explicitly advisory, and node-city has exactly one housing building — a
   residential "specialisation" would have nothing to put in its mix. */
export const FAMILIES = {
  com: { ico: '🛒', name: 'Commercial' },
  off: { ico: '🧠', name: 'Office' },
  ind: { ico: '🏭', name: 'Industrial' },
};

/* ── THE CATALOGUE ──────────────────────────────────────────────────────────
     id      stable, SAVED against every specialised tile. Never renamed.
     cat     the /src/zoning family this sits on top of.
     ico     drawn on the chip.
     short   the chip label. Kept to one or two words — the row has to fit.
     name    the full name, in the detail line and the tooltip.
     desc    one sentence: what the DISTRICT is, not what it costs.
     mix     weighted live BUILDINGS ids, exactly like a zone's `mix`. This is
             the bag /src/zoning picks out of instead of the zone's own, and it
             is then filtered by the tile's land value band.
     lvl     OPTIONAL level target, overriding the zone's. This is the second
             honest difference between two specs whose mixes overlap: a Luxury
             street is the same buildings BUILT TALLER, and the develop pass
             already knows how to grow a tile to a target at the shipped price.
     mythic  marks the 🃏 card districts, which the panel groups apart.
   ────────────────────────────────────────────────────────────────────────── */
export const SPECS = [
  /* ══ 🛒 COMMERCIAL ══════════════════════════════════════════════════════ */
  { id: 'c_retail', cat: 'com', ico: '🛍', short: 'Retail', name: 'Retail',
    mix: [['grocery', 3], ['retail', 3], ['gasstation', 1], ['shop', 1]],
    desc: 'Everyday shopping. Groceries, a parade of units and a forecourt — the street a district actually uses.' },
  { id: 'c_food', cat: 'com', ico: '🍽', short: 'Restaurants', name: 'Restaurants',
    mix: [['restaurant', 3], ['foodtruck', 2], ['grocery', 1]],
    desc: 'A food street. Kitchens, a truck on the corner and the grocer that supplies them both.' },
  { id: 'c_ent', cat: 'com', ico: '🎶', short: 'Nightlife', name: 'Entertainment',
    mix: [['club', 3], ['restaurant', 1]],
    desc: 'The block that is still lit at 2am. Clubs, and the late kitchens that feed the queue.' },
  /* 💎 LUXURY RETAIL. node-city has exactly ONE storefront id (`shop`, the
     Player Shop) and it is the card shop — so "luxury retail" cannot be a
     different BUILDING from mythic retail, and pretending otherwise would be a
     chip that develops the same street under a different name. What it is
     instead is real and visible: the two businesses that carry the margin
     (the club and the restaurant), a single boutique among them, AND `lvl: 3`
     — the same street built to its full height, paid for at the shipped
     upgrade price by the develop pass that already grows zones. */
  { id: 'c_lux', cat: 'com', ico: '💎', short: 'Luxury', name: 'Luxury Retail', lvl: 3,
    mix: [['club', 2], ['restaurant', 2], ['shop', 1]],
    desc: 'The expensive end of the high street, built to its full height. Wants land that has already become valuable — it will not take a cheap plot.' },
  /* 🃏 MYTHIC RETAIL — the headline. `shop` is the Player Shop and
     ECO_BUILDING_MAP founds a `cardShop` firm on it that sells boosterPacks to
     residents out of the city's own printed cards. `retail` is the parade unit
     between the card shops, so a run of them reads as a street. */
  { id: 'c_mythic', cat: 'com', ico: '🃏', short: 'Mythic Retail', name: 'Mythic Retail', mythic: true, lvl: 2,
    mix: [['shop', 3], ['retail', 1]],
    /* ⚠ THE DESC NAMES THE GRADIENT BECAUSE THE GRADIENT IS REAL AND WAS
       MEASURED. `shop` is an Established-band tenant and `retail` is a Modest
       one, so on modest land this district develops parade units and no card
       shops at all. That is the feature working — land value decides which of a
       district's businesses this plot can hold — but a description that
       promised card shops on land that will not take one would be a claim
       nothing checks, so it says both. */
    /* ⚠ AND WHAT IT DOES NOT NAME: GRADING. The brief asks for "card shops,
       graders and collectors" and the first draft of this line printed all
       three — but there is no grading, authentication or slabbing building in
       node-city's BUILDINGS, so a district promising graders advertises a tile
       that cannot develop. Same treatment as printingInk and holographicFoil
       below: the gap is named here so the next hand ADDS THE BUILDING and then
       adds it to this mix, instead of re-deriving the omission and quietly
       putting the word back. */
    desc: 'Card shops and collectors, unit after unit — selling the packs your own presses printed. On land that will not yet carry a shopfront it develops parade units instead.' },
  /* 🏟 MYTHIC ENTERTAINMENT — tournament halls and arenas. The Duel Arena's own
     description is "tactical card battles draw crowds"; the Stadium is the
     event venue /src/city/stadium.* already runs. Both are PRIME-band tenants
     in /src/landvalue, so this district needs the best land the city has made,
     and the panel says which band that is rather than this file claiming it. */
  { id: 'c_mythent', cat: 'com', ico: '🏟', short: 'Mythic Arena', name: 'Mythic Entertainment', mythic: true, lvl: 2,
    mix: [['arena', 2], ['stadium', 1], ['club', 1]],
    desc: 'Tournament halls and duel arenas, with the nightlife that fills up around a card event.' },

  /* ══ 🧠 OFFICE ══════════════════════════════════════════════════════════ */
  /* 🔬 TECHNOLOGY, AND THE ONE HONEST THING TO SAY ABOUT IT: on 🧠 Office park
     it changes NOTHING. `o_low.mix` is [['reslab',1]] and this mix is
     [['reslab',1]] — the same single id — so at every band the filtered bags
     are identical and the plot develops the Research Spire it was always going
     to develop. That is not a reason to delete the spec: on 📈 Office towers
     (mix forge + indexfund) it is a real district, and it is the only way to
     say "research here, not finance". It IS a reason the panel must not offer
     it beside two chips that do change something without saying so, and that
     is enforced rather than described: `inertOn()` in index.js computes the
     pairing from the live zone table and the live band ladder, the chip row
     marks it, and verify() fails if a chip is offered unqualified on a zone it
     cannot change. The old desc here — "the only office district a young city
     can afford" — pointed at exactly the zone where it does nothing, which is
     how a placebo gets shipped with a recommendation attached. */
  { id: 'o_tech', cat: 'off', ico: '🔬', short: 'Technology', name: 'Technology',
    mix: [['reslab', 1]],
    desc: 'Research spires and only research spires — it keeps finance off the block. On an Office park, which already builds nothing else, it changes nothing.' },
  { id: 'o_fin', cat: 'off', ico: '📈', short: 'Financial', name: 'Financial',
    mix: [['forge', 3], ['indexfund', 2]],
    desc: 'Trusts and funds. They mint nothing — they lift every Cinder earner in the city and invest a slice of the takings.' },
  { id: 'o_corp', cat: 'off', ico: '🏢', short: 'Corporate', name: 'Corporate', lvl: 3,
    mix: [['holdco', 2], ['indexfund', 2], ['forge', 1]],
    desc: 'Headquarters. Companies that own companies, on the most expensive land in the city and built to its full height.' },

  /* ══ 🏭 INDUSTRIAL ══════════════════════════════════════════════════════ */
  { id: 'i_manu', cat: 'ind', ico: '🏭', short: 'Manufacturing', name: 'Manufacturing',
    mix: [['machineshop', 2], ['smelter', 2], ['cannery', 2], ['weavery', 1], ['sawmill', 1]],
    desc: 'The general works. Ingots, parts, cloth and cans — the middle of every supply chain the city runs.' },
  { id: 'i_heavy', cat: 'ind', ico: '⚙️', short: 'Heavy', name: 'Heavy Industry',
    mix: [['smelter', 3], ['munitions', 2], ['machineshop', 2]],
    desc: 'Furnaces and presses. The dirtiest, loudest work there is, and it wants to be nowhere near a house.' },
  { id: 'i_log', cat: 'ind', ico: '📦', short: 'Logistics', name: 'Logistics',
    mix: [['warehouse', 3], ['depot', 3], ['motorpool', 1], ['railyard', 1]],
    desc: 'Sheds, yards and docks. Storage capacity and the road cap that comes with depots — a district that stores rather than makes.' },
  /* 🃏 CARD MANUFACTURING — Mythic Industrial. These three tiles are the
     literal input set of a booster pack, and that is ECO_BUILDING_MAP's claim,
     not this file's:
        papermill  → cardStock        printworks → printedCards
        depot      → packagingMaterial
     and recipes.js :581 is `boosterPacks: { printedCards 0.85, packagingMaterial 0.15 }`.
     The brief asks for "card stock, ink, foils, sleeves, booster packaging,
     cards". Card stock, packaging and the cards themselves are real tiles and
     are here. INK AND FOIL ARE NOT: `printingInk`, `inkChemicals` and
     `holographicFoil` exist as resource ids in /src/resources/chain.js but NO
     BUILDING IN node-city MAKES THEM, so a chip promising a foil plant would
     be a district that can never develop one. Named here so the next hand adds
     the tile rather than re-deriving the gap. */
  { id: 'i_cards', cat: 'ind', ico: '🃏', short: 'Card Works', name: 'Card Manufacturing', mythic: true,
    mix: [['papermill', 3], ['printworks', 3], ['depot', 1]],
    desc: 'Pulp, presses and a packing shed — card stock, printed cards and the packaging a booster needs. The whole Ouroboros chain on one street.' },
];

export const SPEC_BY_ID = Object.fromEntries(SPECS.map(s => [s.id, s]));

export function specsFor(cat) { return SPECS.filter(s => s.cat === cat); }

/* ── COMPILE ────────────────────────────────────────────────────────────────
   The same contract /src/zoning uses for its mixes and /src/landvalue uses for
   its tenant table: validate against what is REALLY in the game, drop what is
   not, report ONCE, and never throw. A spec whose bag empties is offered as
   unavailable with its reason, not as a chip that quietly does nothing.

   `admitsAnywhere` is the second check and it is the one that is easy to miss:
   an id can be a perfectly real BUILDINGS key and still be admitted by NO band
   in /src/landvalue, in which case `filterMix()` removes it on every tile in
   the city and the spec is decorative. Passing `null` (no land value module)
   skips that check rather than failing it — absent ⇒ open, everywhere. */
export function compile(BUILDINGS, admitsAnywhere) {
  const bags = {}, dropped = [], unbanded = [], empty = [];
  const haveB = (t) => !!(BUILDINGS && BUILDINGS[t]);
  for (const s of SPECS) {
    const bag = [];
    for (const [type, w] of (s.mix || [])) {
      if (!haveB(type)) { if (dropped.indexOf(type) < 0) dropped.push(type); continue; }
      if (admitsAnywhere && !admitsAnywhere(type)) { if (unbanded.indexOf(type) < 0) unbanded.push(type); continue; }
      for (let i = 0; i < w; i++) bag.push(type);
    }
    bags[s.id] = bag;
    if (!bag.length) empty.push(s.id);
  }
  if (dropped.length) console.warn('[Districts] mix ids not in BUILDINGS, dropped: ' + dropped.join(', '));
  if (unbanded.length) console.warn('[Districts] mix ids no land-value band admits, dropped: ' + unbanded.join(', '));
  if (empty.length) console.warn('[Districts] specialisations with an empty mix (offered as unavailable): ' + empty.join(', '));
  return { bags, dropped, unbanded, empty };
}

/* The self-check the module runs at mount. Graph-level only — it cannot see
   BUILDINGS or the band ladder from here (both are handed over), so what it
   checks is what it can: that the table is a table. */
export function validate() {
  const problems = [], seen = new Set();
  for (const s of SPECS) {
    if (seen.has(s.id)) problems.push('duplicate spec id: ' + s.id);
    seen.add(s.id);
    if (!FAMILIES[s.cat]) problems.push(s.id + ': unknown family ' + s.cat);
    if (!Array.isArray(s.mix) || !s.mix.length) problems.push(s.id + ': empty mix');
    if (s.lvl != null && !(s.lvl >= 1)) problems.push(s.id + ': bad level target ' + s.lvl);
  }
  return problems;
}
