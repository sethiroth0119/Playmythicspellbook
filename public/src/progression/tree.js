/* ══════════════════════════════════════════════════════════════════════════
   🌳 THE RESEARCH TREE — the one table a designer edits.

   THE BRIEF, in the user's own words: "Make a Research tree that players have
   to have a Research PSN license. Connect all of the Licenses & build a node
   to the zones that players can use/create."

   So this is not decoration over an existing system, it IS the join between
   three things that already shipped and never met:

     · OPS_ECON (public/index.html ~80024) — the City Hall LICENCE table. A
       player already buys `research`, `bus`, `rail`, `warehouse`, `genelab`
       there. Those rows are the licences the user wants connected, and this
       file connects them by NAME, never by re-pricing them. No number in this
       file is a price; `licence` is a key into that table and the price is
       whatever _opEcon() says today (CLAUDE.md, rule 4).
     · /src/zoning's eleven zone ids — a menu that is fully open from minute
       one today. `zones` here is what turns them into progression.
     · node-city's BUILDINGS ids.

   ── THE SHAPE OF A NODE ────────────────────────────────────────────────────
     id       stable, saved. NEVER renamed — a save carries these strings.
     cat      category id (CATS below). Drives the left rail.
     name     what the panel prints.
     desc     one sentence, CS2's voice: what the thing IS, not what it costs.
     cost     DEVELOPMENT POINTS. `0` + `auto:true` = a trunk node that is
              already unlocked on a brand-new city (CS2's "BASIC
              TRANSPORTATION SERVICES", which is unlocked in the screenshot).
     req      prerequisite node ids. ALL of them, not any — a cross-category
              req is how the tree stops being six unrelated ladders.
     licence  an OPS_ECON key the player must HOLD before this node can be
              unlocked. The panel names the licence and offers City Hall.
     zones    /src/zoning zone ids this node opens.
     specs    /src/districts DISTRICT SPECIALISATION ids this node opens. Layer
              2 of zoning — a specialisation sits ON TOP of a land-use zone and
              narrows what develops on it, so it is exactly the kind of thing a
              research node should open and it is gated the same way `zones` is.
              ⚠ ABSENT ⇒ OPEN, like everything else here: a spec id this tree
                has never heard of is NOT gated (GOVERNED_SPECS below), so
                adding a fourteenth specialisation next week is playable the day
                it lands rather than silently locked behind a node nobody wrote.
     buildings node-city BUILDINGS ids this node opens.
     ops      OPS_ECON keys this node opens (as opposed to `licence`, which is
              a key it REQUIRES).
     row/col  layout inside the category. col = depth from the trunk, row =
              which line. The connector lines are drawn from `req`, not from
              these — geometry never decides what is connected to what.

   ⚠ EVERY id below is REAL and was checked against the live tables:
     zone ids  → /src/zoning/zones.js
     buildings → node-city's BUILDINGS literal
     licences  → OPS_ECON in public/index.html
     A node naming something that does not exist renders as a node that
     unlocks nothing rather than throwing — see validate() at the bottom, which
     is what the panel's "unlocks" list is built from.

   🔴 THE RESEARCH LICENCE DECISION, AND THE READING THAT WAS REJECTED.
      "players have to have a Research PSN license" could mean the whole panel
      is locked until a player owns `research`. That was rejected: `research`
      is a 700,000 🔥 corporate licence, and gating the ZONE MENU behind it
      would mean a brand-new city cannot zone a house — the same "buy the key
      to the door you need the key to open" wall that the Construction Co.
      fee was deleted for (index.html, OPS_FREE_LICENCE).
      What ships instead: the 🔬 RESEARCH branch requires the licence, and that
      branch is the prerequisite for every advanced node in the tree — towers,
      office towers, warehousing. A player without the Research Facility can
      run a small city; they cannot build a dense one. The licence gates the
      DEPTH of the tree rather than its door.
      To take the other reading it is one line: give `civ_basic` a
      `licence: 'research'`. Everything downstream already refuses on an
      unmet licence, so nothing else needs to change.
   ══════════════════════════════════════════════════════════════════════════ */

/* The left rail. `ico` is drawn at 18px; `blurb` is the rail tooltip. */
export const CATS = [
  { id: 'civ', ico: '🏛', name: 'Civics',         blurb: 'The registry, the services and the landmarks a city is judged on.' },
  { id: 'res', ico: '🏘', name: 'Residential',    blurb: 'What people are allowed to live in, and how densely.' },
  { id: 'com', ico: '🛒', name: 'Commerce',       blurb: 'Shops, nightlife and the offices that do not smoke.' },
  { id: 'ind', ico: '🏭', name: 'Industry',       blurb: 'Extraction, heavy work and the freight it generates.' },
  { id: 'tra', ico: '🚌', name: 'Transportation', blurb: 'Roads, buses and rail. Every rung above the first is a licence.' },
  { id: 'sci', ico: '🔬', name: 'Research',       blurb: 'The Research Facility licence, and everything it makes possible.' },
  /* 🃏 THE MYTHIC BRANCH — the three card districts, in their own category.
     It is a category rather than three nodes scattered through Commerce and
     Industry for two reasons, and the second one is the load-bearing one:
       1. it is the headline of the whole feature and the thing that separates
          this city builder from every other one, so it should read as a
          destination and not as a footnote on an office node;
       2. the panel's tree pane is ~774px and a node past col 3 renders under
          the detail pane (see res_mixed's note). Hanging three more nodes off
          com_high would have needed col 4 and col 5. */
  { id: 'myth', ico: '🃏', name: 'Mythic',         blurb: 'Card districts. The presses that print them, the streets that sell them and the halls they are played in.' },
];

export const NODES = [
  /* ══ 🏛 CIVICS ══════════════════════════════════════════════════════════
     THE TRUNK. `civ_basic` costs nothing and is unlocked on a brand-new city,
     which is what stops this whole system from being a wall in front of a
     player who has not earned a point yet. It carries the STARTER ZONES: the
     three a city genuinely cannot begin without, plus `r_asbuilt`, the
     grandfather zone /src/zoning adopts standing houses into. */
  { id: 'civ_basic', cat: 'civ', row: 1, col: 0, cost: 0, auto: true, req: [],
    name: 'Basic City Services',
    desc: 'The land registry every settlement starts with. Houses, a parade of shops and somewhere to make things.',
    zones: ['r_asbuilt', 'r_low', 'c_low', 'i_mfg'] },
  { id: 'civ_services', cat: 'civ', row: 1, col: 1, cost: 1, req: ['civ_basic'],
    name: 'Municipal Services',
    desc: 'A clinic, a fire station and a police station — the three buildings a city is measured by when something goes wrong.',
    buildings: ['clinic', 'firestation', 'police'] },
  { id: 'civ_parks', cat: 'civ', row: 0, col: 2, cost: 1, req: ['civ_services'],
    name: 'Parks & Recreation',
    desc: 'Planting, water features and the small green things that make a street worth walking down.',
    buildings: ['garden', 'fountain', 'tree', 'bush'] },
  { id: 'civ_landmark', cat: 'civ', row: 2, col: 2, cost: 3, req: ['civ_services'],
    name: 'Civic Landmarks',
    desc: 'The arena and the stadium. Expensive, loud, and the reason people come in from the other cities.',
    buildings: ['arena', 'stadium'] },

  /* ══ 🏘 RESIDENTIAL ═════════════════════════════════════════════════════
     Five of the six residential zone grades. The sixth (`r_low`) is on the
     trunk above, because a city with no housing zone is not a city. */
  { id: 'res_row', cat: 'res', row: 1, col: 1, cost: 1, req: ['civ_basic'],
    name: 'Row Housing',
    desc: 'Wall-to-wall terraces that close a street block instead of scattering across it.',
    zones: ['r_row'] },
  { id: 'res_rent', cat: 'res', row: 0, col: 2, cost: 1, req: ['res_row'],
    name: 'Low Rent Housing',
    desc: 'Large blocks of small flats. Cheap and plain, and where the young and the broke actually live.',
    zones: ['r_rent'] },
  { id: 'res_apt', cat: 'res', row: 2, col: 2, cost: 2, req: ['res_row'],
    name: 'Apartments',
    desc: 'Walk-up blocks with balconies and a shared entrance — the first real step up in density.',
    zones: ['r_apt'] },
  /* 🔗 THE CROSS-CATEGORY LINK, and the reason the tree is a tree. Mixed use
     answers residential AND commercial demand from one strip, so it cannot be
     reached from the residential ladder alone. */
  { id: 'res_mixed', cat: 'res', row: 3, col: 3, cost: 3, req: ['res_apt', 'com_high'],
    name: 'Mixed Use',
    desc: 'Retail at street level, flats above. One zone that answers residential and commercial demand at once.',
    zones: ['r_mixed'] },
  /* col 3, not 4: the tree pane is ~774px wide inside the panel and a fifth
     column pushes the node under the detail pane. Measured, not guessed. */
  { id: 'res_high', cat: 'res', row: 1, col: 3, cost: 4, req: ['res_apt', 'sci_urban'],
    name: 'High-Density Towers',
    desc: 'The tallest residential the city builds. Needs the engineering before it needs the land.',
    zones: ['r_high'] },

  /* ══ 🛒 COMMERCE & OFFICE ═══════════════════════════════════════════════ */
  { id: 'com_high', cat: 'com', row: 0, col: 1, cost: 2, req: ['civ_basic'],
    name: 'High-Density Commercial',
    desc: 'Nightlife and the big retail sheds. Loud, profitable, and a bad neighbour for a quiet street.',
    zones: ['c_high'], buildings: ['club', 'retail'] },
  /* 🏢 ROUND 17: this node now unlocks a BUILDING as well as a zone, and until
     it did it was the clearest example in the tree of a node whose promise the
     catalogue could not keep — "jobs for the educated" opening land that
     developed a Research Spire. `office` and `o_low` unlock together because
     they are the same decision: the zone is the land use and the block is what
     stands on it, and a player who has one and not the other has neither. */
  { id: 'off_low', cat: 'com', row: 2, col: 1, cost: 2, req: ['civ_basic'],
    name: 'Office Park',
    desc: 'Clean work on cheap land — no freight, no smoke, and jobs for the educated.',
    zones: ['o_low'], buildings: ['office'] },
  /* 🏙 LAYER 2 ENTERS THE TREE HERE. `com_district` is the node that turns
     "Commercial" from one generic paint into a district a player composes, and
     it deliberately requires com_high: specialising land use is a decision that
     only means anything once there is more than one grade of it. */
  { id: 'com_district', cat: 'com', row: 1, col: 2, cost: 2, req: ['com_high'],
    name: 'District Specialisation',
    desc: 'Zoning stops being generic. A commercial block can be told what kind of commerce it is for — shops, or kitchens.',
    specs: ['c_retail', 'c_food'] },
  { id: 'com_night', cat: 'com', row: 0, col: 3, cost: 3, req: ['com_district', 'civ_landmark'],
    name: 'Entertainment District',
    desc: 'A block zoned for the night. Clubs and late kitchens, and the noise that comes with them.',
    specs: ['c_ent'] },
  /* 🔗 A CROSS-CATEGORY LINK, and the reason it is here: a luxury street is the
     same buildings BUILT TALLER (specs.js `lvl: 3`), and this city may not
     build tall anywhere until High-Rise Engineering is done. */
  { id: 'com_luxury', cat: 'com', row: 1, col: 3, cost: 4, req: ['com_district', 'sci_urban'],
    name: 'Luxury Retail',
    desc: 'The expensive end of the high street, built to its full height. It will simply refuse cheap land.',
    specs: ['c_lux'] },
  /* 🔴 THIS NODE OPENS THE FINANCIAL DISTRICT AND NOT THE TECHNOLOGY ONE, AND
     THE REASON IS A MEASURED DEFECT RATHER THAN A PREFERENCE. It shipped with
     both, and `MythicDistricts.verify()` on a driven city reported
     "o_tech: no band admits any of reslab today" — because the ONLY building a
     Technology district builds is the Research Spire, and `reslab` is opened by
     `sci_lab` over in Research. A player could therefore research a district
     that was guaranteed to develop nothing, which is precisely the failure this
     project has already paid for ("a progression tree advertised building
     unlocks that nothing checked"). The specialisation now hangs off the node
     that opens its one building — see `sci_lab` below. */
  { id: 'off_district', cat: 'com', row: 3, col: 2, cost: 2, req: ['off_low'],
    name: 'Financial District',
    desc: 'An office park told what it is for: trusts and funds rather than laboratories.',
    specs: ['o_fin'] },
  { id: 'off_high', cat: 'com', row: 2, col: 3, cost: 4, req: ['off_low', 'sci_urban'],
    name: 'Office Towers',
    desc: 'The skyline. Same clean work, stacked, on land that has become too valuable for anything else.',
    zones: ['o_high'], specs: ['o_corp'] },

  /* ══ 🏭 INDUSTRY & LOGISTICS ════════════════════════════════════════════ */
  { id: 'ind_extract', cat: 'ind', row: 1, col: 1, cost: 1, req: ['civ_basic'],
    name: 'Resource Extraction',
    desc: 'Taking the raw world out of the ground — scrap, stone and timber, and the shafts and leach works that reach the seams a surface pit cannot.',
    /* ⛏ `deepmine` and `alloyworks` join the node that already opens the two
       buildings they were costed from (`scrapmine`, `quarry`). They are the
       same act one level deeper, and a node of their own would be a rung with
       one building on it.
       ⚠ THE OTHER THREE OF THAT ROUND ARE DELIBERATELY UNGATED, each matching
         the tile it was derived from: `farm`, `hydrofarm`, `fibercroft`,
         `purifier` and `siphon` appear on no node in this tree, so
         `canecroft`, `waterintake` and `riftbore` do not either. Gating the
         Water Intake in particular would put the city's whole water supply
         behind a development point. */
    buildings: ['scrapmine', 'quarry', 'lumbercamp', 'deepmine', 'alloyworks'] },
  { id: 'ind_heavy', cat: 'ind', row: 1, col: 2, cost: 2, req: ['ind_extract'],
    name: 'Heavy Industry',
    desc: 'Smelting, machining and canning. The dirty middle of every supply chain the city runs.',
    buildings: ['smelter', 'machineshop', 'cannery'] },
  /* 🔗 A LICENCE LINK. Warehousing is a real business the player buys at City
     Hall; the ZONE is the land you are allowed to put it on. Holding one
     without the other is meaningless, so the node requires the licence. */
  { id: 'ind_district', cat: 'ind', row: 0, col: 2, cost: 2, req: ['ind_heavy'],
    name: 'Industrial Specialisation',
    desc: 'Industry stops being one paint. A works district and a furnace district are not the same street and should not build the same way.',
    specs: ['i_manu', 'i_heavy'] },
  /* 🔗 The Logistics SPECIALISATION rides the node that already opens the
     warehousing ZONE and its City Hall licence, rather than taking a node of
     its own: holding the zone without the district, or the district without the
     licence, would be two half-features. */
  { id: 'ind_ware', cat: 'ind', row: 1, col: 3, cost: 3, req: ['ind_heavy', 'sci_materials'],
    licence: 'warehouse',
    name: 'Warehousing & Logistics',
    desc: 'Land zoned for storage and distribution rather than for making anything.',
    zones: ['i_ware'], buildings: ['warehouse'], specs: ['i_log'] },
  /* 🔧 THE DEEPEST RUNG ON THIS BRANCH, and priced to be. Public Works repairs
     damaged buildings on its own at half the usual bill and keeps doing it
     while the player is away — the first thing in this city that acts without
     being clicked, so it is gated behind the two heaviest industrial rungs AND
     the materials line, and costs more points than anything else on the tree.
     ⚠ It unlocks the right to BUILD it, not the building. The tile itself is
       the most expensive in the city and asks for seven different inputs, so a
       player reaching this node still has a real project in front of them
       rather than a reward. */
  { id: 'ind_works', cat: 'ind', row: 2, col: 4, cost: 5, req: ['ind_ware', 'ind_district'],
    name: 'Public Works Department',
    desc: 'A standing repair crew on the city payroll. Damaged buildings are put right without you, at half cost — and the crew does not stop when you log off.',
    buildings: ['repairyard'] },

  /* ══ 🚌 TRANSPORTATION ══════════════════════════════════════════════════
     The branch the user's own screenshot shows, mirrored: a free trunk, then
     rungs that each cost a licence as well as points. */
  { id: 'tra_basic', cat: 'tra', row: 1, col: 0, cost: 0, auto: true, req: ['civ_basic'],
    name: 'Basic Transportation Services',
    desc: 'Roads and supply depots. Everything a city can move before it can move people.',
    buildings: ['road', 'depot'] },
  { id: 'tra_bus', cat: 'tra', row: 1, col: 1, cost: 2, req: ['tra_basic'], licence: 'bus',
    name: 'Bus Network',
    desc: 'Stops, and player-drawn routes between them. Public transport never turns a profit — it reduces a subsidy.',
    buildings: ['busstop'] },
  { id: 'tra_rail', cat: 'tra', row: 1, col: 2, cost: 4, req: ['tra_bus'], licence: 'rail',
    name: 'Rail Network',
    desc: 'Track, stations and a yard. The expensive rung, and the only one that moves freight.',
    buildings: ['trainstation', 'railtrack', 'railyard'] },

  /* ══ 🔬 RESEARCH ════════════════════════════════════════════════════════
     THE BRANCH THE USER ASKED FOR BY NAME. `sci_lab` requires the Research
     Facility licence — OPS_ECON.research, the row that already exists and
     already yields memoryShards — and everything else in this category hangs
     off it. `sci_urban` and `sci_materials` are then prerequisites in OTHER
     categories, which is how the licence reaches the whole tree without
     standing in front of the front door. */
  { id: 'sci_lab', cat: 'sci', row: 1, col: 0, cost: 1, req: ['civ_basic'], licence: 'research',
    name: 'Research Division',
    desc: 'A working laboratory, and land zoned for a district of them. The Research Facility licence is the door; this is what the city does once it is through.',
    buildings: ['reslab'], specs: ['o_tech'] },
  { id: 'sci_materials', cat: 'sci', row: 0, col: 1, cost: 2, req: ['sci_lab'],
    name: 'Materials Science',
    desc: 'Better metallurgy and better cloth — the inputs half of the chain rather than the outputs half.',
    buildings: ['forge', 'weavery'] },
  /* ⚠ UNLOCKS NOTHING DIRECTLY, ON PURPOSE, and the panel says so rather than
     inventing a filler building for it. Its entire product is the two zone
     nodes that require it. */
  { id: 'sci_urban', cat: 'sci', row: 1, col: 1, cost: 3, req: ['sci_lab'],
    name: 'High-Rise Engineering',
    desc: 'Lifts, cores and foundations deep enough to stand on. Required before any land in this city may be built tall.',
    zones: [], buildings: [] },
  { id: 'sci_genetics', cat: 'sci', row: 2, col: 1, cost: 4, req: ['sci_lab'], licence: 'genelab',
    name: 'Applied Genetics',
    desc: 'The clinical end of the laboratory, and the only industrial source of DNA in the game.',
    buildings: ['medlab'] },

  /* ══ 🃏 MYTHIC ══════════════════════════════════════════════════════════
     THE THREE CARD DISTRICTS, and the order is the Ouroboros chain's own:

        timber → lumber → cardStock → printedCards → boosterPacks
        lumbercamp  sawmill  PAPERMILL   PRINTWORKS    SHOP

     You must be able to PRINT a card before you may zone a street that sells
     one, and you must have a street that sells them before a hall that plays
     them is worth building. That is `myth_press → myth_street → myth_arena`,
     and it is a real dependency in ECO_BUILDING_MAP rather than a themed
     ordering: a Mythic Retail district with no presses anywhere founds card
     shops whose recipe bottlenecks on `printedCards`, which is the exact state
     the Card Shop sat in for the whole first year of this game.

     ⚠ THESE NODES OPEN SPECIALISATIONS ONLY — NO `buildings:` KEY, DELIBERATELY.
       `papermill`, `printworks`, `shop`, `arena` and `stadium` are all
       placeable today and are not governed by this tree. Listing them here
       would GATE them, retro-locking a live city out of buildings it can place
       right now, and adoption only counts standing buildings for saves that
       predate progression (state.js, the one asymmetry). The new thing is the
       district; the buildings stay exactly as free as they were. */
  { id: 'myth_press', cat: 'myth', row: 1, col: 0, cost: 4, req: ['ind_district', 'sci_materials'],
    name: 'Ouroboros Manufacturing',
    desc: 'Pulp, plates and a packing shed. Land zoned for the presses that print this world\'s cards.',
    specs: ['i_cards'] },
  { id: 'myth_street', cat: 'myth', row: 1, col: 1, cost: 5, req: ['myth_press', 'com_district'],
    name: 'Mythic Retail District',
    desc: 'A street of card shops, graders and collectors — selling the packs your own presses printed.',
    specs: ['c_mythic'] },
  { id: 'myth_arena', cat: 'myth', row: 1, col: 2, cost: 6, req: ['myth_street', 'civ_landmark'],
    name: 'Mythic Entertainment District',
    desc: 'Tournament halls and duel arenas. The best land in the city, and the reason people come in from the other cities.',
    specs: ['c_mythent'] },
];

export const NODE_BY_ID = Object.create(null);
for (const n of NODES) NODE_BY_ID[n.id] = n;

/* Nodes that are unlocked on a city that has never spent a point. */
export const AUTO_NODES = NODES.filter((n) => n.auto).map((n) => n.id);

/* Every zone id the tree can ever open, so the state layer can tell "a zone
   this tree governs" from "a zone id it has never heard of". A zone the tree
   does not mention is NOT gated — that is the safe direction, and it is what
   makes adding a twelfth zone id to /src/zoning a non-event here. */
export const GOVERNED_ZONES = (() => {
  const s = new Set();
  for (const n of NODES) for (const z of (n.zones || [])) s.add(z);
  return s;
})();

export const GOVERNED_BUILDINGS = (() => {
  const s = new Set();
  for (const n of NODES) for (const b of (n.buildings || [])) s.add(b);
  return s;
})();

/* Every district specialisation this tree can open. Same contract as
   GOVERNED_ZONES: a spec id the tree does not mention is NOT gated. */
export const GOVERNED_SPECS = (() => {
  const s = new Set();
  for (const n of NODES) for (const p of (n.specs || [])) s.add(p);
  return s;
})();

/* What a node opens, as one list, for the detail pane. */
export function unlocksOf(node) {
  if (!node) return { zones: [], specs: [], buildings: [], ops: [] };
  return {
    zones: (node.zones || []).slice(),
    specs: (node.specs || []).slice(),
    buildings: (node.buildings || []).slice(),
    ops: (node.ops || []).slice(),
  };
}

/* The total cost of clearing the tree. Printed in the panel footer so a player
   can see how far 48 points of milestones actually goes — DERIVED, never
   written down twice. */
export function totalCost() {
  let t = 0;
  for (const n of NODES) t += n.cost | 0;
  return t;
}

/* ── the self-check ────────────────────────────────────────────────────────
   Run at mount. It cannot see BUILDINGS or the zone table from here (those are
   handed over), so what it checks is what it CAN: that the graph is a graph.
   A cycle or a dangling prerequisite is a node no player could ever unlock,
   and it would look completely fine in review. */
export function validate() {
  const problems = [];
  const seen = new Set();
  for (const n of NODES) {
    if (seen.has(n.id)) problems.push('duplicate node id: ' + n.id);
    seen.add(n.id);
    if (!CATS.some((c) => c.id === n.cat)) problems.push(n.id + ': unknown category ' + n.cat);
    for (const r of (n.req || [])) if (!NODE_BY_ID[r]) problems.push(n.id + ': prerequisite does not exist — ' + r);
  }
  /* Reachability, which is the one that matters: walk out from the auto nodes
     and see whether every node is eventually satisfiable. */
  const open = new Set(AUTO_NODES);
  let moved = true;
  while (moved) {
    moved = false;
    for (const n of NODES) {
      if (open.has(n.id)) continue;
      if ((n.req || []).every((r) => open.has(r))) { open.add(n.id); moved = true; }
    }
  }
  for (const n of NODES) if (!open.has(n.id)) problems.push(n.id + ': unreachable — its prerequisites can never all be met');
  return problems;
}
