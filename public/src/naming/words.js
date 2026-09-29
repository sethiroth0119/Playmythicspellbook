/* ══════════════════════════════════════════════════════════════════════════
   🏷 THE NAME CORPORA — every word the city's business register is built from.

   WHY A TABLE AND NOT A NETWORK CALL: this runs offline, in a page whose CDN
   is blocked, in a save that must open identically on a device that has never
   been online. A name that came from a service is a name that changes when the
   service does, and a business that renames itself between sessions is a bug
   the player experiences as their city being wrong.

   WHY A TRADE WORD PER BUILDING TYPE AND NOT PER CATEGORY: the whole point is
   that "a shop is not named like a foundry". `Ashby Smelting Works` and
   `Ashby Provisions` are the same generator with a different noun, and the
   noun is what carries the read. There is one row here for every placeable in
   BUILDINGS plus every operation blueprint; anything unknown falls through to
   GENERIC rather than rendering "undefined".

   The reference the user gave is "Annu's Interior Design" — a PERSON plus a
   TRADE. That is why the given-name and surname pools are the biggest things
   in this file and why the person-shaped patterns come first in the retail
   register: a possessive human name is what makes a shop read as somebody's.
   ══════════════════════════════════════════════════════════════════════════ */

/* Deliberately wide. A city is ~170 buildings; a 64-name pool crossed with 72
   surnames, 48 places and 6-8 patterns per register is a space big enough that
   the de-duplicator almost never has to re-roll, which is what keeps names
   stable when a player adds a building next to an existing one. */
export const GIVEN = [
  'Annu', 'Mira', 'Osei', 'Rafael', 'Ingrid', 'Tomas', 'Hana', 'Yusuf',
  'Priya', 'Dmitri', 'Selma', 'Kwame', 'Noor', 'Elias', 'Ayla', 'Bruno',
  'Lena', 'Hiro', 'Rosa', 'Amara', 'Viktor', 'Sanne', 'Jamil', 'Freya',
  'Otto', 'Ndidi', 'Leila', 'Marcus', 'Sofia', 'Emre', 'Talia', 'Basil',
  'Iris', 'Kenji', 'Mateo', 'Anwen', 'Rurik', 'Zosia', 'Cato', 'Meera',
  'Halvard', 'Juno', 'Ilya', 'Neve', 'Sami', 'Delphine', 'Arto', 'Rani',
  'Casper', 'Odile', 'Tarek', 'Bea', 'Ansel', 'Yara', 'Gustav', 'Nia',
  'Rowan', 'Suri', 'Lars', 'Esme', 'Kian', 'Malia', 'Dorian', 'Petra',
];

export const SURNAME = [
  'Ashby', 'Merrow', 'Vance', 'Holloway', 'Okonkwo', 'Calder', 'Ferreira',
  'Bright', 'Nakamura', 'Sorel', 'Vasquez', 'Thorne', 'Adeyemi', 'Larkin',
  'Duval', 'Ostrom', 'Bellamy', 'Kaur', 'Whitlock', 'Iversen', 'Salgado',
  'Penrose', 'Abadi', 'Cormack', 'Nystrom', 'Ravel', 'Sandoval', 'Halvorsen',
  'Quill', 'Marchetti', 'Fenwick', 'Bergstrom', 'Ilyin', 'Moreau', 'Trent',
  'Achebe', 'Whitby', 'Lindqvist', 'Rosales', 'Garrick', 'Hulme', 'Nasser',
  'Pike', 'Vandermeer', 'Cobb', 'Astley', 'Farrow', 'Rennick', 'Solberg',
  'Grieve', 'Vasari', 'Wren', 'Yoxall', 'Brandt', 'Chaudhry', 'Delacroix',
  'Emberly', 'Falk', 'Gould', 'Hargrave', 'Ives', 'Kestrel', 'Lowry',
  'Mbeki', 'Norwood', 'Orsini', 'Pelham', 'Quintero', 'Ridley', 'Stavros',
  'Tanaka', 'Ulriksen',
];

/* Doubles as the street-name stem, so a fallback address and a business name
   drawn on the same city read as belonging to the same place. */
export const PLACE = [
  'Ashgrove', 'Larkspur', 'Thistledown', 'Ironhold', 'Deepcut', 'Halloway',
  'Verity', 'Blackmoor', 'Copperfield', 'Marrow', 'Silverbrook', 'Northgate',
  'Old Kiln', 'Saltmarsh', 'Cinderfell', 'Ravenhill', 'Millrace', 'Windrow',
  'Beacon', 'Quarrystone', 'Fernhead', 'Greyfriar', 'Amberlight', 'Stonecross',
  'Willowbank', 'Highfen', 'Redcastle', 'Bramble', 'Torchlight', 'Emberdown',
  'Foxfield', 'Nettlebed', 'Oakhaven', 'Pallas', 'Quayside', 'Riverbend',
  'Standfast', 'Tallow', 'Undercliff', 'Vellum', 'Whitcombe', 'Yardley',
  'Coldharbour', 'Hollowmere', 'Kingsfold', 'Longacre', 'Netherby', 'Spindlewick',
];

export const ADJECTIVE = [
  'Copper', 'Gilded', 'Crooked', 'Iron', 'Amber', 'Salted', 'Quiet',
  'Weathered', 'Bright', 'Blue', 'Rusted', 'Golden', 'Hollow', 'Sable',
  'Verdant', 'Honest', 'Stubborn', 'Merry', 'Old', 'Half-Moon',
];

export const OBJECT = [
  'Ladle', 'Anvil', 'Lantern', 'Kettle', 'Sparrow', 'Compass', 'Cog',
  'Barrel', 'Thistle', 'Crown', 'Spindle', 'Nail', 'Beacon', 'Hound',
  'Wheel', 'Cask', 'Lark', 'Anchor', 'Sixpence', 'Bell',
];

/* Firm suffixes. Kept off the retail register on purpose: "Annu's Provisions
   Ltd." reads like a filing, not a shop. */
export const SUFFIX = ['Co.', '& Co.', 'Works', 'Ltd.', 'Group', 'Holdings', 'Industries', 'Partners'];

export const HOUSE_WORD = ['Court', 'Row', 'Terrace', 'Rise', 'Gardens', 'Mews', 'Yard', 'Walk', 'Buildings', 'Heights', 'Place', 'Close'];

export const STREET_SUFFIX = ['Street', 'Road', 'Row', 'Lane', 'Way', 'Avenue', 'Rise', 'Terrace', 'Walk', 'Close'];

/* ── the registers ────────────────────────────────────────────────────────
   A register is a naming GRAMMAR, not a building category: it decides whether
   a name sounds like a person's shop, a firm, a farm, an institution, an
   arcane order, a residential block or a piece of greenery. */
export const PATTERNS = {
  retail: [
    "{G}'s {T}", "{G}'s {T}", "{S} & Sons {T}", '{S} & {S2}',
    'The {A} {O}', '{P} {T}', '{G} {S} {T}', "{S}'s {T}", 'The {P} {T}',
  ],
  industry: [
    '{S} {T} {X}', '{P} {T} Works', '{P} {T} {X}', '{S} & {S2} {T}',
    '{P} {T}', '{S} {T}', '{A} {O} {T}',
  ],
  agri: [
    '{P} {T}', '{S} Family {T}', "{S}'s {T}", 'The {P} {T}',
    '{P} {T}', '{A} {O} {T}',
  ],
  civic: [
    '{P} {T}', 'The {S} {T}', '{G} {S} Memorial {T}', '{P} District {T}',
    "St. {G}'s {T}", '{P} {T}',
  ],
  arcane: [
    'The {A} {O}', '{P} {T}', '{S} {T}', 'The {P} {T}', '{P} {T} {X}',
  ],
  home: [
    '{P} {H}', '{A} {O} {H}', '{S} {H}', 'The {P} {H}', '{P} {H}',
  ],
  green: [
    '{P} {T}', '{S} {T}', 'The {A} {T}', '{P} {T}',
  ],
};

/* ── one row per placeable ────────────────────────────────────────────────
   [register, [trade nouns]]. The trade noun is the load-bearing half: it is
   what tells a player at a glance that they are reading a foundry and not a
   grocer, in a panel where the blueprint name is now a subtitle. */
export const TRADE = {
  /* production */
  farm:         ['agri', ['Farm', 'Fields', 'Farmstead', 'Acres', 'Holding', 'Growers']],
  hydrofarm:    ['agri', ['Hydroponics', 'Grow Rooms', 'Vertical Farm', 'Green Stacks', 'Culture Farm']],
  purifier:     ['agri', ['Waterworks', 'Purification', 'Water Co.', 'Reclamation', 'Springs']],
  scrapmine:    ['industry', ['Mining', 'Ore Works', 'Diggings', 'Extraction', 'Minerals']],
  fuelrig:      ['industry', ['Drilling', 'Petroleum', 'Oil', 'Derricks', 'Fuels']],
  gasstation:   ['retail', ['Fuel', 'Filling Station', 'Service Station', 'Pumps', 'Motor Fuels']],
  lumbercamp:   ['agri', ['Logging', 'Timber Camp', 'Woodcutters', 'Forestry']],
  quarry:       ['industry', ['Quarry', 'Stoneworks', 'Aggregates', 'Pit']],
  fibercroft:   ['agri', ['Croft', 'Fibre Farm', 'Cotton Works', 'Fields']],
  /* ⛏ the extraction round. Register follows the neighbour each was derived
     from: the intake and the croft are `agri` like the Purifier and the Fiber
     Croft, the two mines are `industry` like the Mine and the Quarry, and the
     bore is `arcane` like the Siphon. */
  waterintake:  ['agri', ['Intake', 'Water Board', 'Headworks', 'Abstraction', 'Wells']],
  deepmine:     ['industry', ['Deep Mine', 'Shaft', 'Colliery', 'Workings', 'Lode']],
  alloyworks:   ['industry', ['Minerals', 'Leach Works', 'Concentrator', 'Strategic Metals', 'Refining']],
  canecroft:    ['agri', ['Cane Croft', 'Cane Fields', 'Seed Farm', 'Plantation', 'Sugar Lands']],
  /* food & service */
  foodtruck:    ['retail', ['Wagon', 'Cart', 'Street Kitchen', 'Rolling Kitchen', 'Van']],
  restaurant:   ['retail', ['Kitchen', 'Table', 'Bistro', 'Dining Rooms', 'Grill', 'Chophouse']],
  grocery:      ['retail', ['Grocers', 'Market', 'Foods', 'Produce', 'Larder', 'Greengrocer']],
  clinic:       ['civic', ['Clinic', 'Surgery', 'Health Centre', 'Dispensary']],
  club:         ['retail', ['Club', 'Lounge', 'Social Club', 'Rooms', 'Assembly Rooms']],
  /* refining */
  cannery:      ['industry', ['Cannery', 'Preserves', 'Packing Works', 'Food Works']],
  smelter:      ['industry', ['Smelting', 'Foundry', 'Ironworks', 'Smeltery', 'Metal Works']],
  machineshop:  ['industry', ['Machine Works', 'Engineering', 'Fabrication', 'Toolworks']],
  sawmill:      ['industry', ['Sawmill', 'Timber Works', 'Lumber', 'Planing Mill']],
  weavery:      ['industry', ['Weavery', 'Textiles', 'Mills', 'Loom Works', 'Cloth']],
  powerstation: ['industry', ['Power Station', 'Generating Works', 'Electric', 'Powerhouse']],
  warehouse:    ['industry', ['Warehousing', 'Storage', 'Bonded Store', 'Depository']],
  /* infrastructure */
  depot:        ['industry', ['Supply Depot', 'Stores', 'Logistics', 'Yard']],
  caravanpost:  ['retail', ['Caravan Post', 'Haulage', 'Carriers', 'Freight Office', 'Waystation']],
  railyard:     ['industry', ['Rail Yard', 'Sidings', 'Freight Terminal', 'Junction']],
  lot:          ['retail', ['Lot', 'Development Plot', 'Site', 'Parcel']],
  /* civic */
  housing:      ['home', ['Court', 'Row', 'Terrace', 'Rise']],
  medlab:       ['civic', ['Clinic', 'Med Lab', 'Infirmary', 'Health Centre', 'Surgery']],
  arena:        ['civic', ['Arena', 'Fighting Pit', 'Coliseum', 'Grounds']],
  shop:         ['retail', ['Provisions', 'General Store', 'Emporium', 'Trading Post', 'Sundries', 'Mercantile', 'Supply']],
  stadium:      ['civic', ['Stadium', 'Grounds', 'Park', 'Bowl']],
  resthouse:    ['civic', ['Resting House', 'Lodgings', 'Guest House', 'Rooms']],
  /* defense */
  barracks:     ['civic', ['Barracks', 'Garrison', 'Muster Hall', 'Company Lines']],
  tower:        ['civic', ['Watchtower', 'Lookout', 'Signal Tower', 'Beacon']],
  police:       ['civic', ['Precinct', 'Station House', 'Watch House', 'Constabulary']],
  firestation:  ['civic', ['Fire Station', 'Fire House', 'Brigade', 'Engine House']],
  munitions:    ['industry', ['Munitions', 'Ordnance', 'Armoury', 'Arms Works', 'Powder Works']],
  motorpool:    ['industry', ['Motor Pool', 'Garage', 'Motor Works', 'Transport Yard']],
  /* office & financial */
  office:       ['arcane', ['Chambers', 'Offices', 'House', 'Business Centre', 'Bureau', 'Works']],
  forge:        ['arcane', ['Trust', 'Assay Office', 'Mint', 'Exchange']],
  indexfund:    ['arcane', ['Index Fund', 'Investments', 'Capital', 'Asset Management']],
  holdco:       ['arcane', ['Holdings', 'Group', 'Holding Co.', 'Consolidated']],
  /* arcane */
  reslab:       ['arcane', ['Research', 'Laboratories', 'Institute', 'Field Lab']],
  siphon:       ['arcane', ['Siphon', 'Extraction Works', 'Draw Station', 'Conduit']],
  riftbore:     ['arcane', ['Deep Bore', 'Rift Bore', 'Sounding', 'Deep Works', 'Tap']],
  obelisk:      ['arcane', ['Obelisk', 'Monument', 'Standing Stone', 'Pillar']],
  kalonstable:  ['civic', ['Stables', 'Paddock', 'Kalon Yard', 'Stalls']],
  /* decoration */
  tree:         ['green', ['Grove', 'Copse', 'Stand', 'Walk']],
  bush:         ['green', ['Hedge', 'Thicket', 'Border', 'Screen']],
  garden:       ['green', ['Gardens', 'Green', 'Plot', 'Allotments']],
  fountain:     ['green', ['Fountain', 'Waterpoint', 'Basin', 'Memorial']],

  /* ── operations (the op_ blueprints registered by the City Hall layer) ──
     These normally show the licence label from `corp_operations` instead —
     see registry.nameFor. The rows exist for the case where the bridge cannot
     answer, so a sited operation still reads as a business and not as a husk. */
  op_mining:       ['industry', ['Mining', 'Minerals', 'Extraction']],
  op_oil:          ['industry', ['Petroleum', 'Oil', 'Drilling']],
  op_gas:          ['retail', ['Fuels', 'Filling Stations', 'Forecourts']],
  op_construction: ['industry', ['Construction', 'Builders', 'Contracting', 'Civil Works']],
  op_salvage:      ['industry', ['Salvage', 'Reclamation', 'Breakers', 'Scrap']],
  op_cars:         ['retail', ['Motors', 'Autos', 'Motor Co.', 'Cars']],
  op_agri:         ['agri', ['Agriculture', 'Farms', 'Growers', 'Estates']],
  op_fishing:      ['agri', ['Fisheries', 'Fishing Co.', 'Trawlers']],
  op_medical:      ['civic', ['Medical', 'Health Group', 'Infirmary', 'Care']],
  op_research:     ['arcane', ['Research', 'Laboratories', 'Institute']],
  op_cardshop:     ['retail', ['Cards', 'Card Shop', 'Collectables', 'Gallery']],
  op_dojo:         ['civic', ['Dojo', 'School of Arms', 'Training Hall']],
  op_bank:         ['retail', ['Bank', 'Savings & Loan', 'Trust Bank', 'Credit Union']],
  op_warehouse:    ['industry', ['Warehousing', 'Storage', 'Logistics']],
  /* ⚫ Deliberately the blandest row in the table. A smuggling front that
     advertises itself is not a front. */
  op_smuggling:    ['industry', ['Import & Export', 'Freight', 'Consolidated', 'Trading']],
};

export const GENERIC = ['retail', ['Company', 'Works', 'Trading', 'Concern']];

/* 🚫 NOT NAMED, and each for its own reason:
     road / streetlight — a road's name belongs to /src/streets, which owns
       named streets. Naming a road tile here would be a second, conflicting
       answer to the same question.
     wall / gate — fortification, not premises.
     anchor — a Node Anchor already carries the node's own name from the game.
   Everything else in BUILDINGS gets a name, because "name every business"
   read against a city where half the buildings are unnamed reads as a bug. */
/* ⚠ 'road' HERE IS THE LEGACY CLASS ONLY. This is a static table and cannot
   call the road resolver, so registry.js ORs it with isRoadType() — a Lane and
   every future carriageway class is suppressed there, not by an entry added
   here. Adding class ids to this list would be the list-shaped form of the
   bare-string tile-type bug (see TRUCK_STOPS, node-city). */
export const NO_NAME = new Set(['road', 'streetlight', 'wall', 'gate', 'anchor']);
