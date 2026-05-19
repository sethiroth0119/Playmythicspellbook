// data.js — mock economy data for the Corporation prototype.
// Everything is plain JS so files can be edited without restart.

window.ECON = (function () {
  const PLAYER = {
    id: 'P-0001',
    handle: 'SETHIROTH',
    title: 'Voidwarden',
    aza: 184_320,
    corp: 'BLACK SUN',
    corpRole: 'Quartermaster',
    rep: 0.84,
    repTrades: 247,
    repScams: 0,
    avatar: '#c64a2a',
  };

  const RARITY = {
    common:    { label: 'Common',    color: '#7d7973', glow: 'none' },
    rare:      { label: 'Rare',      color: '#5fa3d1', glow: '0 0 18px rgba(95,163,209,.18)' },
    epic:      { label: 'Epic',      color: '#a978d8', glow: '0 0 18px rgba(169,120,216,.22)' },
    legendary: { label: 'Legendary', color: '#d9a14a', glow: '0 0 18px rgba(217,161,74,.28)' },
    mythic:    { label: 'Mythic',    color: '#d05a3d', glow: '0 0 22px rgba(208,90,61,.30)' },
    anomaly:   { label: 'Anomaly',   color: '#c75dd4', glow: '0 0 22px rgba(199,93,212,.34)' },
    unique:    { label: 'Unique',    color: '#e8d089', glow: '0 0 26px rgba(232,208,137,.36)' },
  };

  // Universal asset registry. Every transferable thing in the game.
  // Categories: resource, relic, item, card, hero, equipment, deed, contraband
  const ASSETS = [
    // ── Resources ──────────────────────────────────────────────────────
    { id:'AST-R-0001', kind:'resource', name:'Iron',            qty:14_280, unit:'kg', rarity:'common',    icon:'cube',     tradable:true, market:0.42 },
    { id:'AST-R-0002', kind:'resource', name:'Stone',           qty:8_140,  unit:'kg', rarity:'common',    icon:'pebble',   tradable:true, market:0.18 },
    { id:'AST-R-0003', kind:'resource', name:'Wood',            qty:6_902,  unit:'kg', rarity:'common',    icon:'log',      tradable:true, market:0.22 },
    { id:'AST-R-0004', kind:'resource', name:'Food',            qty:2_104,  unit:'rat', rarity:'common',   icon:'tin',      tradable:true, market:0.61 },
    { id:'AST-R-0005', kind:'resource', name:'Medicine',        qty:142,    unit:'kit', rarity:'rare',     icon:'cross',    tradable:true, market:14.20 },
    { id:'AST-R-0006', kind:'resource', name:'Energy Cells',    qty:418,    unit:'cell',rarity:'rare',     icon:'cell',     tradable:true, market:9.84 },
    { id:'AST-R-0007', kind:'resource', name:'Crystal',         qty:74,     unit:'sh',  rarity:'rare',     icon:'crystal',  tradable:true, market:32.10 },
    { id:'AST-R-0008', kind:'resource', name:'Relic Dust',      qty:31,     unit:'g',   rarity:'epic',     icon:'dust',     tradable:true, market:88.40 },
    { id:'AST-R-0009', kind:'resource', name:'Card Ink',        qty:12,     unit:'vial',rarity:'epic',     icon:'vial',     tradable:true, market:142.0 },
    { id:'AST-R-0010', kind:'resource', name:'Blood Money',     qty:980,    unit:'AZA', rarity:'rare',     icon:'coin',     tradable:true, market:1.0,  flag:'illicit' },
    { id:'AST-R-0011', kind:'resource', name:'Data Cores',      qty:46,     unit:'core',rarity:'epic',     icon:'core',     tradable:true, market:124.0 },
    { id:'AST-R-0012', kind:'resource', name:'Cinder',          qty:208,    unit:'kg',  rarity:'common',   icon:'flame',    tradable:true, market:1.40 },
    { id:'AST-R-0013', kind:'resource', name:'Contraband',      qty:6,      unit:'crate',rarity:'epic',    icon:'crate',    tradable:true, market:980.0, flag:'illicit' },
    { id:'AST-R-0014', kind:'resource', name:'Fuel',            qty:1_120,  unit:'L',   rarity:'common',   icon:'drum',     tradable:true, market:2.10 },
    { id:'AST-R-0015', kind:'resource', name:'Scrap Metal',     qty:4_402,  unit:'kg',  rarity:'common',   icon:'shard',    tradable:true, market:0.32 },
    { id:'AST-R-0016', kind:'resource', name:'Biomass',         qty:710,    unit:'kg',  rarity:'common',   icon:'organ',    tradable:true, market:0.94 },
    { id:'AST-R-0017', kind:'resource', name:'Demon Essence',   qty:9,      unit:'vial',rarity:'mythic',   icon:'sigil',    tradable:true, market:1_240.0, flag:'occult' },
    { id:'AST-R-0018', kind:'resource', name:'Void Fragments',  qty:18,     unit:'sh',  rarity:'anomaly',  icon:'tear',     tradable:true, market:880.0, flag:'anomaly' },
    { id:'AST-R-0019', kind:'resource', name:'Nano Components', qty:54,     unit:'pc',  rarity:'epic',     icon:'chip',     tradable:true, market:64.0 },

    // ── Relics ─────────────────────────────────────────────────────────
    { id:'AST-RL-0042', kind:'relic', name:'Ancient Reactor Core', rarity:'legendary',
      effect:'+15% Energy generation', slot:'camp', tradable:true, equipped:'Forge-04',
      foundBy:'PlayerX', origin:'Site-7 Collapse, Y2 Q3' },
    { id:'AST-RL-0067', kind:'relic', name:'Crown of the Fallen King', rarity:'mythic',
      effect:'Heroes gain +5% EXP', slot:'hero', tradable:true, equipped:null,
      foundBy:'SETHIROTH', origin:'Drowned Chapel, Y3 Q1' },
    { id:'AST-RL-0091', kind:'relic', name:'Void Compass', rarity:'epic',
      effect:'+8% rare loot chance', slot:'hero', tradable:true, equipped:'Hero-Asha',
      foundBy:'PlayerY', origin:'Anomaly Tide IV' },
    { id:'AST-RL-0118', kind:'relic', name:'Sigil of the Hollow Choir', rarity:'unique',
      effect:'Demon Essence yield ×2 at altars', slot:'camp', tradable:true, equipped:null,
      foundBy:'SETHIROTH', origin:'First Choral Breach',
      note:'Only one exists in this world.' },
    { id:'AST-RL-0144', kind:'relic', name:'Pre-Collapse Ledger', rarity:'rare',
      effect:'Marketplace tax −2%', slot:'corp', tradable:true, equipped:'BLACK SUN' },
    { id:'AST-RL-0157', kind:'relic', name:'Reliquary Lantern', rarity:'epic',
      effect:'Camp morale +6', slot:'camp', tradable:true, equipped:'Forward Camp K' },

    // ── Items ──────────────────────────────────────────────────────────
    { id:'AST-IT-2001', kind:'item', name:'Medical Kit',       rarity:'common', qty:48,  use:'consumable' },
    { id:'AST-IT-2002', kind:'item', name:'Ammo Pack',         rarity:'common', qty:312, use:'consumable' },
    { id:'AST-IT-2003', kind:'item', name:'Portable Reactor',  rarity:'rare',   qty:4,   use:'deployable' },
    { id:'AST-IT-2004', kind:'item', name:'Drone Scanner',     rarity:'rare',   qty:6,   use:'tool' },
    { id:'AST-IT-2005', kind:'item', name:'Card Sleeves',      rarity:'common', qty:120, use:'cosmetic' },
    { id:'AST-IT-2006', kind:'item', name:'Mutation Serum',    rarity:'epic',   qty:3,   use:'consumable', flag:'illicit' },
    { id:'AST-IT-2007', kind:'item', name:'Lockbreaker Tool',  rarity:'rare',   qty:2,   use:'tool',       flag:'illicit' },
    { id:'AST-IT-2008', kind:'item', name:'Ancient Batteries', rarity:'epic',   qty:11,  use:'crafting' },
    { id:'AST-IT-2009', kind:'item', name:'Containment Shards',rarity:'mythic', qty:1,   use:'crafting',   flag:'anomaly' },
    { id:'AST-IT-2010', kind:'item', name:'Illegal Chemicals', rarity:'rare',   qty:14,  use:'crafting',   flag:'illicit' },

    // ── Heroes ─────────────────────────────────────────────────────────
    { id:'AST-HR-0301', kind:'hero', name:'Commander Paul',    rarity:'legendary', level:42, role:'Vanguard',  equipped:[ 'AST-RL-0091' ] },
    { id:'AST-HR-0307', kind:'hero', name:'Asha Vorne',        rarity:'epic',      level:31, role:'Scout',     equipped:[ 'AST-RL-0091' ] },
    { id:'AST-HR-0314', kind:'hero', name:'Ferro the Mute',    rarity:'rare',      level:24, role:'Smuggler' },
    { id:'AST-HR-0322', kind:'hero', name:'Sister Tiamat',     rarity:'mythic',    level:48, role:'Occultist', equipped:[ 'AST-RL-0067' ] },

    // ── Cards ──────────────────────────────────────────────────────────
    { id:'AST-CD-1102', kind:'card', name:'Stillborn Engine',  rarity:'epic',      school:'Tech' },
    { id:'AST-CD-1118', kind:'card', name:'Concord of Maggots',rarity:'mythic',    school:'Decay' },
    { id:'AST-CD-1140', kind:'card', name:'Inheritance Tax',   rarity:'legendary', school:'Civic' },
    { id:'AST-CD-1166', kind:'card', name:'Black Sun Rising',  rarity:'unique',    school:'Occult', note:'Once-only printing' },

    // ── Deeds ──────────────────────────────────────────────────────────
    { id:'AST-DD-0044', kind:'deed', name:'Drowned Chapel',     rarity:'legendary', tier:'T4', district:'Outer Verge', generates:'Demon Essence' },
    { id:'AST-DD-0061', kind:'deed', name:'Iron Foundry 04',    rarity:'epic',      tier:'T3', district:'Foundry Belt', generates:'Iron' },
    { id:'AST-DD-0072', kind:'deed', name:'Tenement, Row 14',   rarity:'common',    tier:'T1', district:'Lower Wards',  generates:'Food' },
  ];

  // Ownership / transaction history. Anchored to asset id.
  const HISTORY = {
    'AST-RL-0067': [
      { ts:'Y3 Q1 D14', who:'Found by SETHIROTH', note:'Drowned Chapel — first descent', type:'origin' },
      { ts:'Y3 Q2 D03', who:'Loaned to BLACK SUN vault', type:'vault' },
      { ts:'Y3 Q2 D44', who:'Equipped → Sister Tiamat', type:'equip' },
    ],
    'AST-RL-0118': [
      { ts:'Y3 Q3 D08', who:'First contact — Sethiroth', note:'Choral Breach event', type:'origin' },
      { ts:'Y3 Q3 D08', who:'Globally registered as Unique', type:'flag' },
    ],
    'AST-RL-0042': [
      { ts:'Y2 Q3 D11', who:'Recovered by PlayerX', type:'origin' },
      { ts:'Y2 Q4 D02', who:'Sold → BLACK SUN  (32,000 AZA)', type:'sale' },
      { ts:'Y3 Q1 D17', who:'Installed at Forge-04', type:'equip' },
    ],
  };

  // Marketplace listings
  const LISTINGS = [
    { id:'L-7741', asset:'Ancient Reactor Core', kind:'relic',    rarity:'legendary', price:34_500, seller:'WRAITH-9',     sellerRep:0.92, qty:1,    posted:'2h',  trend:'up'   },
    { id:'L-7758', asset:'Iron',                  kind:'resource', rarity:'common',    price:0.39,   seller:'IronHand Co.', sellerRep:0.88, qty:50_000, posted:'12m', trend:'down' },
    { id:'L-7763', asset:'Medicine',              kind:'resource', rarity:'rare',      price:14.80,  seller:'Dr. Mire',     sellerRep:0.77, qty:240,  posted:'48m', trend:'up'   },
    { id:'L-7769', asset:'Void Compass',          kind:'relic',    rarity:'epic',      price:9_200,  seller:'NULLCANTO',    sellerRep:0.69, qty:1,    posted:'4h',  trend:'flat' },
    { id:'L-7771', asset:'Commander Paul',        kind:'hero',     rarity:'legendary', price:62_000, seller:'Black Sun',    sellerRep:0.94, qty:1,    posted:'1d',  trend:'up',  corp:true },
    { id:'L-7780', asset:'Stillborn Engine',      kind:'card',     rarity:'epic',      price:1_840,  seller:'CARDSHARK',    sellerRep:0.71, qty:1,    posted:'3h',  trend:'flat' },
    { id:'L-7791', asset:'Drowned Chapel',        kind:'deed',     rarity:'legendary', price:148_000,seller:'Sethiroth',    sellerRep:0.84, qty:1,    posted:'5h',  trend:'up',  mine:true },
    { id:'L-7799', asset:'Data Cores',            kind:'resource', rarity:'epic',      price:128.0,  seller:'AI-Lab Klyx',  sellerRep:0.81, qty:32,   posted:'1h',  trend:'up'   },
    { id:'L-7810', asset:'Card Ink',              kind:'resource', rarity:'epic',      price:139.0,  seller:'Scriptorium',  sellerRep:0.85, qty:18,   posted:'6h',  trend:'flat' },
    { id:'L-7814', asset:'Reliquary Lantern',     kind:'relic',    rarity:'epic',      price:6_700,  seller:'BoneCarvers',  sellerRep:0.74, qty:1,    posted:'2h',  trend:'down' },
  ];

  const BLACK_MARKET = [
    { id:'B-0102', asset:'Mutation Serum',     kind:'item',     rarity:'epic',    price:1_240,  seller:'???',         risk:'high',   qty:5,  posted:'47m' },
    { id:'B-0118', asset:'Contraband Crate',   kind:'resource', rarity:'epic',    price:1_080,  seller:'WHISPER',     risk:'high',   qty:3,  posted:'1h' },
    { id:'B-0123', asset:'Demon Essence',      kind:'resource', rarity:'mythic',  price:1_410,  seller:'CHORAL',      risk:'extreme',qty:2,  posted:'22m' },
    { id:'B-0140', asset:'Forbidden Card: Maggots', kind:'card', rarity:'mythic', price:18_400, seller:'???',         risk:'extreme',qty:1,  posted:'3h' },
    { id:'B-0151', asset:'Void Fragments',     kind:'resource', rarity:'anomaly', price:980,    seller:'NULLCANTO',   risk:'extreme',qty:12, posted:'1d' },
    { id:'B-0162', asset:'Lockbreaker Tool',   kind:'item',     rarity:'rare',    price:340,    seller:'TINKER-W',    risk:'medium', qty:8,  posted:'2h' },
  ];

  // Mail / inbox
  const MAIL = [
    { id:'M-441', from:'WRAITH-9', subject:'Re: Reactor Core inquiry', preview:'Counter offer: 34,500 AZA, you cover insurance.', ts:'8m', unread:true,
      attach:[{kind:'aza', qty:34_500}] },
    { id:'M-440', from:'BLACK SUN — Vault', subject:'Withdrawal logged', preview:'You withdrew 500 Iron for Forward Camp K.', ts:'1h', unread:true,
      attach:[{kind:'resource', name:'Iron', qty:500}] },
    { id:'M-439', from:'Marketplace', subject:'Item sold', preview:'Drone Scanner ×1 sold for 740 AZA. Tax 22 AZA.', ts:'3h', unread:false,
      attach:[{kind:'aza', qty:718}] },
    { id:'M-438', from:'NULLCANTO', subject:'Trade returned', preview:'You rejected the offered trade. Items returned.', ts:'5h', unread:false,
      attach:[{kind:'relic', name:'Void Compass'}] },
    { id:'M-437', from:'Sister Tiamat', subject:'(gift) for the Choir', preview:'A small token. Do not open it inside the camp.', ts:'1d', unread:false,
      attach:[{kind:'item', name:'Containment Shard', qty:1}] },
    { id:'M-435', from:'Logistics — Convoy 14', subject:'Arrived', preview:'500 Iron delivered Foundry Belt → Forward Camp K.', ts:'1d', unread:false,
      attach:[] },
    { id:'M-431', from:'Anomaly Watch', subject:'BREACH — Outer Verge', preview:'Void Fragment market +42% in last 6h.', ts:'2d', unread:false,
      attach:[] },
  ];

  // Logistics — in-flight convoys
  const CONVOYS = [
    { id:'CV-014', from:'Foundry Belt', to:'Forward Camp K', cargo:'500 Iron',         eta:'12m', risk:0.22, escort:'2 Outriders',  status:'in-transit', progress:0.68 },
    { id:'CV-019', from:'Drowned Chapel', to:'BLACK SUN Vault', cargo:'4 Demon Essence', eta:'1h 04m', risk:0.61, escort:'Sister Tiamat', status:'in-transit', progress:0.31, flag:'occult' },
    { id:'CV-022', from:'AI Lab Klyx',  to:'Marketplace',    cargo:'32 Data Cores',   eta:'34m', risk:0.18, escort:'Drone Wing-3', status:'in-transit', progress:0.52 },
    { id:'CV-008', from:'Tenement R-14', to:'Forward Camp K',cargo:'1,200 Food',      eta:'arrived', risk:0.08, escort:'None',         status:'arrived',    progress:1.0 },
    { id:'CV-025', from:'Black Market',  to:'???',           cargo:'2 Contraband',    eta:'unknown', risk:0.84, escort:'WHISPER',      status:'in-transit', progress:0.12, flag:'illicit' },
  ];

  // Server-wide economic events
  const EVENTS = [
    { tag:'BREACH',    text:'Anomaly Tide IV — Void Fragment +42%',         tone:'anomaly' },
    { tag:'SHORTAGE',  text:'Medicine reserves down 18% server-wide',       tone:'warning' },
    { tag:'SEIZURE',   text:'Government raid: 4 contraband caches lost',    tone:'danger'  },
    { tag:'CARAVAN',   text:'Rare caravan arrives Outer Verge in 02:14:00', tone:'info'    },
    { tag:'DISCOVERY', text:'New Unique relic registered: Sigil of the Hollow Choir', tone:'unique' },
    { tag:'CRASH',     text:'Black market: Mutation Serum −31%',            tone:'warning' },
  ];

  // Recent transaction log (universal feed)
  const FEED = [
    { ts:'00:02', actor:'SETHIROTH', verb:'sent', obj:'500 Iron', target:'PlayerX', kind:'send' },
    { ts:'00:08', actor:'NULLCANTO', verb:'listed', obj:'Void Compass', target:'9,200 AZA', kind:'list' },
    { ts:'00:14', actor:'WRAITH-9', verb:'offered trade to', obj:'SETHIROTH', target:'Reactor Core ⇄ 34,500 AZA', kind:'trade' },
    { ts:'00:21', actor:'BLACK SUN', verb:'funded war', obj:'Crimson Pact', target:'12,000 AZA', kind:'corp' },
    { ts:'00:33', actor:'CHORAL',    verb:'listed (black)', obj:'2× Demon Essence', target:'1,410 AZA', kind:'black' },
    { ts:'00:41', actor:'Convoy 14', verb:'arrived', obj:'500 Iron', target:'Forward Camp K', kind:'logi' },
  ];

  // Players directory — for "send to player" autocomplete
  const PLAYERS = [
    { id:'P-0002', handle:'WRAITH-9',  corp:'Pale Order',  rep:0.92, online:true },
    { id:'P-0003', handle:'NULLCANTO', corp:'—',           rep:0.69, online:true },
    { id:'P-0004', handle:'PlayerX',   corp:'IronHand Co.',rep:0.88, online:false },
    { id:'P-0005', handle:'Dr. Mire',  corp:'Pale Order',  rep:0.77, online:true },
    { id:'P-0006', handle:'CHORAL',    corp:'Hollow Choir',rep:0.51, online:false },
    { id:'P-0007', handle:'TINKER-W',  corp:'—',           rep:0.81, online:true },
    { id:'P-0008', handle:'Sister Tiamat', corp:'Hollow Choir', rep:0.74, online:false },
  ];

  // ── Real Estate ───────────────────────────────────────────────────────
  // Properties are player-owned deeds, listed by player-realtors. Map x/y
  // are 0–100 percentages within a stylized district map.
  // Districts: foundry, verge, lower, drowned, ai, anomaly
  const DISTRICTS = {
    foundry:  { id:'foundry',  name:'Foundry Belt',     tone:'rust',  blurb:'Heavy industry, smoke, output' },
    verge:    { id:'verge',    name:'Outer Verge',      tone:'void',  blurb:'Edge of known map, anomalies' },
    lower:    { id:'lower',    name:'Lower Wards',      tone:'flat',  blurb:'Dense housing, low tax, high turnover' },
    drowned:  { id:'drowned',  name:'Drowned Quarter',  tone:'danger',blurb:'Flooded ruin, occult sites' },
    ai:       { id:'ai',       name:'AI Districts',     tone:'rare',  blurb:'Pre-Collapse compute, walled' },
    anomaly:  { id:'anomaly',  name:'Anomaly Strip',    tone:'void',  blurb:'Forbidden by treaty. Buy fast.' },
  };

  const PROPERTIES = [
    { id:'DD-0044', name:'Drowned Chapel',         district:'drowned', tier:'T4', price:148_000, generates:'Demon Essence', rate:'2/d',  workforce:6,  plots:1, area:'320 m²', tax:'4.2%', built:'Pre-Coll.', x:36, y:82, status:'sale', showcase:true, photos:5, agent:'P-0008', flag:'occult',
      attrs:['Pre-Collapse stonework','Active altar (occupied)','Tidal protection','Cult-warded'],
      special:['ONLY ALTAR IN-SHARD','TIDE-FED RESOURCE','BLACK MARKET ACCESS','UNIQUE EVENT TRIGGER'] },
    { id:'DD-0061', name:'Iron Foundry 04',        district:'foundry', tier:'T3', price:62_400,  generates:'Iron',          rate:'240/h', workforce:24, plots:6, area:'1,820 m²', tax:'5.0%', built:'Y1',  x:40, y:18, status:'sale', showcase:true, photos:8, agent:'P-0004',
      attrs:['Twin blast lines','Smoke clearance permit','Rail spur on-site','Foreman quarters'],
      special:['HIGHEST IRON OUTPUT','RAIL ACCESS','TWO SHIFTS POSSIBLE','UPGRADE-READY'] },
    { id:'DD-0072', name:'Tenement Row 14',        district:'lower',   tier:'T1', price:8_200,   generates:'Food',          rate:'120/d', workforce:4,  plots:2, area:'180 m²', tax:'1.8%', built:'Y2',  x:54, y:42, status:'sale', showcase:false, photos:4, agent:'P-0003',
      attrs:['18 units','Communal kitchen','Low maintenance','Quiet block'],
      special:['STEADY UPKEEP','LOW BARRIER OF ENTRY','RENTABLE TO RECRUITS'] },
    { id:'DD-0088', name:'Coalshade Bunker',       district:'foundry', tier:'T2', price:24_500,  generates:'Cinder',        rate:'40/h',  workforce:8,  plots:3, area:'540 m²', tax:'3.4%', built:'Y0',  x:46, y:26, status:'sale', showcase:false, photos:6, agent:'P-0007',
      attrs:['Reinforced shell','Vent stack intact','Fuel cache included','Sentry post'],
      special:['BLAST-RATED','FUEL ON SITE','OFF-GRID CAPABLE'] },
    { id:'DD-0103', name:'Klyx Data Spire',        district:'ai',      tier:'T4', price:212_000, generates:'Data Cores',    rate:'6/h',  workforce:3,  plots:1, area:'460 m²', tax:'6.0%', built:'Pre-Coll.', x:42, y:54, status:'auction', showcase:true, photos:7, agent:'P-0002',
      attrs:['Active compute (12 racks)','Atmospheric controls','Pre-Collapse architecture','Walled compound'],
      special:['ACTIVE COMPUTE','FACTION-NEUTRAL ZONE','RARE RELIC SPAWN','RESEARCH UNLOCK'] },
    { id:'DD-0114', name:'Verge Outpost K',        district:'verge',   tier:'T2', price:18_400,  generates:'Void Fragments',rate:'1/d',  workforce:5,  plots:2, area:'380 m²', tax:'2.6%', built:'Y3',  x:84, y:42, status:'sale', showcase:false, photos:5, agent:'P-0003', flag:'anomaly',
      attrs:['Anomaly proximity (480m)','Reinforced berm','Watchtower','Insurance recommended'],
      special:['VOID FRAG YIELD','RARE LOOT EVENTS','OUTSIDE LAW'] },
    { id:'DD-0121', name:'Apothecary Row',         district:'lower',   tier:'T2', price:31_000,  generates:'Medicine',      rate:'4/d',  workforce:6,  plots:2, area:'220 m²', tax:'2.2%', built:'Y1',  x:50, y:60, status:'sale', showcase:true, photos:7, agent:'P-0005',
      attrs:['Licensed dispensary','Cold storage','Clinic adjacency','Sublet potential'],
      special:['HIGH MARGIN','LICENSED','TIES TO PALE ORDER'] },
    { id:'DD-0142', name:'Greyfield Allotments',   district:'lower',   tier:'T1', price:5_200,   generates:'Food',          rate:'80/d', workforce:3,  plots:4, area:'1,200 m²', tax:'1.4%', built:'Y2',  x:56, y:54, status:'sale', showcase:false, photos:3, agent:'P-0003',
      attrs:['Topsoil intact','South-facing','Adjacent well','Fence in repair'],
      special:['LOW CAPEX','EASY UPGRADE PATH'] },
    { id:'DD-0158', name:'Hollow Choir Sanctum',   district:'anomaly', tier:'T4', price:184_000, generates:'Demon Essence', rate:'3/d',  workforce:9,  plots:1, area:'410 m²', tax:'5.4%', built:'Pre-Coll.', x:91, y:80, status:'auction', showcase:true, photos:6, agent:'P-0006', flag:'occult',
      attrs:['Concord-protected','Altar (occupied)','Catacomb access','Choral defenses'],
      special:['CONCORD-PROTECTED','UNIQUE CHANTS','ALTAR SHARED W/ SECT'] },
    { id:'DD-0170', name:'Cargo Yard 03',          district:'foundry', tier:'T2', price:14_800,  generates:'Scrap Metal',   rate:'140/d',workforce:4,  plots:3, area:'860 m²', tax:'2.8%', built:'Y0',  x:32, y:30, status:'sale', showcase:false, photos:4, agent:'P-0004',
      attrs:['Crane intact','Container slots ×24','Office trailer','Diesel pump'],
      special:['HIGH THROUGHPUT','LOGISTICS-ADJACENT'] },
    { id:'DD-0188', name:'Old Customs House',      district:'verge',   tier:'T3', price:48_600,  generates:'Contraband',    rate:'2/d',  workforce:5,  plots:1, area:'520 m²', tax:'3.2%', built:'Pre-Coll.', x:87, y:30, status:'sale', showcase:true, photos:6, agent:'P-0007', flag:'illicit',
      attrs:['Smuggler tunnel ×2','Inspector-bribed','Vault on site','Ledger-burned'],
      special:['SMUGGLER NETWORK','OFF-LEDGER INCOME','RAID-HARDENED'] },
    { id:'DD-0203', name:'Spire 7 Penthouse',      district:'ai',      tier:'T4', price:96_000,  generates:'Reputation',    rate:'+0.5/wk', workforce:1, plots:1, area:'280 m²', tax:'4.8%', built:'Pre-Coll.', x:38, y:60, status:'sale', showcase:true, photos:8, agent:'P-0002',
      attrs:['Skybridge access','Private elevator','Pre-Collapse glass','Air recycler'],
      special:['SOCIAL CAPITAL','HOSTS DIPLOMACY','PRESTIGE'] },
  ];

  const REVIEWS = {
    'P-0002': [
      { who:'PlayerX',  stars:5, text:'Closed our deal on Spire 7 in under a day. Knows the AI districts cold.' },
      { who:'Sethiroth', stars:5, text:'Discreet and fast. No bribes left on the table.' },
      { who:'Dr. Mire',  stars:4, text:'Pushy but effective. Got me through inspection.' },
    ],
    'P-0008': [
      { who:'CHORAL',    stars:5, text:'The only realtor who understands altar-bearing deeds.' },
      { who:'NULLCANTO', stars:5, text:'Closed Drowned Chapel without breaking the wards.' },
    ],
  };

  return { PLAYER, RARITY, ASSETS, HISTORY, LISTINGS, BLACK_MARKET, MAIL, CONVOYS, EVENTS, FEED, PLAYERS, DISTRICTS, PROPERTIES, REVIEWS };
})();
