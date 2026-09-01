/* 🗺 MISSION MAP — the districts, their POIs, and the factions pressing them.
   ═══════════════════════════════════════════════════════════════════════════
   PURE DATA + PURE FUNCTIONS. No DOM, no I/O, no globals. Everything here is
   safe to import from anywhere, including a test page with no game attached.

   A district is a MISSION SITE. Its POI decides what the run is worth; the
   faction holding it decides how hard the run is. Those are the only two
   levers, and they both funnel into ONE field on the generated campaign —
   `difficulty` — because index.html already reads that field twice:

     _rlcDiffBand(camp)  → RLC_HAUL_PROFILES  (what the run drops)
     _rlcDiffBonus(camp) → battlePrep.enemyLevel (+4 hard, +8 nightmare)

   So "a faction-held district drops better loot AND fights harder" needs no
   new engine code at all. It needs the right string. That is the whole trick,
   and it is why nothing in /src/missions reaches into the battle engine.
   ═══════════════════════════════════════════════════════════════════════════ */

export const FACTIONS = {
  survivors: { id:'survivors', name:'Survivors',      color:'#3d8bfd', short:'SURV' },
  scum:      { id:'scum',      name:'The Scum',       color:'#c3d63f', short:'SCUM',
               // fast, wide, shallow — cheap to push back, constantly there
               push:{ rate:[4,9], spread:0.45, seed:[8,16] },
               foe:'Scum Warlord', mob:'Scum Grunt' },
  anomalies: { id:'anomalies', name:'The Anomalies',  color:'#a855f7', short:'ANOM',
               // jumps without regard for adjacency; deep when it lands
               push:{ rate:[2,6], spread:0.30, seed:[14,26] },
               foe:'Breach Event', mob:'Corrupted Host' },
  scp:       { id:'scp',       name:'SCP Foundation', color:'#ff5a3c', short:'SCP',
               // slow, relentless, sticky. Their sites SEAL — see isScp below.
               push:{ rate:[2,4], spread:0.22, seed:[10,18] },
               foe:'MTF Team Leader', mob:'Foundation Guard' },
};
export const FACTION_IDS = ['scum','anomalies','scp'];

/* 🏚 POI TYPES — what is actually at the location.
   `band` is the FLOOR difficulty when the survivors hold it; grip pushes it up
   from there (see difficultyFor). `nodes` is the base length of the run. */
export const MISSION_POI = {
  school:      { icon:'🏫', label:'Schoolhouse',      band:0, nodes:5, flavour:'Classrooms stripped to the studs, but the cafeteria stores held.' },
  supermarket: { icon:'🛒', label:'Supermarket',      band:0, nodes:5, flavour:'Picked over a hundred times. The loading dock never was.' },
  firehouse:   { icon:'🚒', label:'Fire Station',     band:1, nodes:6, flavour:'Cutting gear, bottled air, and a truck that might still turn over.' },
  depot:       { icon:'🏭', label:'Rail Depot',       band:1, nodes:6, flavour:'Container yard. Whatever was in transit is still in transit.' },
  ironworks:   { icon:'🔨', label:'Ironworks',        band:1, nodes:6, flavour:'Cold furnaces, full scrap bins, and a roof that leaks raiders.' },
  hospital:    { icon:'🏥', label:'Hospital',         band:2, nodes:7, flavour:'Pharmacy on sub-level two. So is everything that came up through it.' },
  substation:  { icon:'⚡', label:'Grid Substation',  band:2, nodes:7, flavour:'Copper, transformer oil, and the only thing that could light the camp.' },
  vault:       { icon:'🏦', label:'Reserve Vault',    band:3, nodes:8, flavour:'The Foundation moved something into the deposit floor. It is still down there.' },
  scar:        { icon:'⚠️', label:'Containment Scar', band:3, nodes:8, flavour:'The park grew wrong. Nothing that walks out of it is what walked in.' },
};

/* 🗽 THE SITES — ruined Manhattan, ten districts.
   `gy` bands and the east/west split are the district's footprint on the
   generated island; `pin` places its label card clear of its neighbours.
   Real neighbourhood names on purpose: Manhattan's own geography is the most
   recognisable street layout there is, and it costs nothing to borrow. */
export const SITES = [
  { id:'harlem',  name:'Harlem',          poi:'school',      hBase:0.46, ruin:0.26, pin:{dx: 96,dy:-52} },
  { id:'uws',     name:'Upper West',      poi:'supermarket', hBase:0.66, ruin:0.20, pin:{dx:-116,dy:-28} },
  { id:'park',    name:'The Green',       poi:'scar',        hBase:0.00, ruin:0.00, pin:{dx: 118,dy:-50} },
  { id:'ues',     name:'Upper East',      poi:'hospital',    hBase:0.68, ruin:0.18, pin:{dx: 134,dy:-60} },
  { id:'hells',   name:"Hell's Kitchen",  poi:'firehouse',   hBase:0.56, ruin:0.38, pin:{dx:-134,dy: -6} },
  { id:'midtown', name:'Midtown',         poi:'substation',  hBase:1.00, ruin:0.30, pin:{dx: 142,dy: 40} },
  { id:'chelsea', name:'Chelsea',         poi:'depot',       hBase:0.66, ruin:0.24, pin:{dx:-132,dy: 30} },
  { id:'village', name:'The Village',     poi:'supermarket', hBase:0.46, ruin:0.22, pin:{dx:-120,dy: 46} },
  { id:'soho',    name:'SoHo',            poi:'ironworks',   hBase:0.50, ruin:0.26, pin:{dx: 104,dy: 46} },
  { id:'battery', name:'The Battery',     poi:'vault',       hBase:0.92, ruin:0.34, pin:{dx: -26,dy: 66} },
];
export const SITE_BY_ID = {};
SITES.forEach(s => { SITE_BY_ID[s.id] = s; });

/* Which districts border which — how a faction spreads on a tick. */
export const ADJACENCY = {
  harlem:['uws','ues'], uws:['harlem','park','hells'], park:['uws','ues','midtown'],
  ues:['harlem','park','midtown'], hells:['uws','midtown','chelsea'],
  midtown:['park','ues','hells','chelsea'], chelsea:['hells','midtown','village'],
  village:['chelsea','soho'], soho:['village','battery'], battery:['soho'],
};

/* ── grip → everything ─────────────────────────────────────────────────── */

/* The four rungs. `label` is player-facing; `diff` is the string handed to the
   campaign, chosen to land on the band we want inside index.html's OWN
   regexes — do not "tidy" these words without re-reading _rlcDiffBand and
   _rlcDiffBonus, which match on /hard|veteran|elite/ and /night|brutal|…/. */
export const BANDS = [
  { min:0,  key:'normal', label:'Normal',     diff:'Normal',    haul:'food · water · supplies',            accent:'#7d8ba0' },
  { min:25, key:'hard',   label:'Hard',       diff:'Hard',      haul:'ammo · fuel · metal · medicine',      accent:'#e0b356' },
  { min:50, key:'harder', label:'Hard +',     diff:'Veteran',   haul:'fuel · medicine · corrupted essence', accent:'#ff8c42' },
  { min:90, key:'brutal', label:'Stronghold', diff:'Nightmare', haul:'SCP samples · memory shards · DNA',   accent:'#ff5a3c' },
];

/* The POI's own floor and the faction's grip both raise the rung; whichever is
   higher wins. A survivor-held vault is still a hard run — it is a vault. */
export function bandFor(site, grip) {
  const floor = (MISSION_POI[site.poi] || {}).band || 0;
  let byGrip = 0;
  for (let i = 0; i < BANDS.length; i++) if ((grip|0) >= BANDS[i].min) byGrip = i;
  return BANDS[Math.max(floor, byGrip)];
}
export function difficultyFor(site, grip) { return bandFor(site, grip).diff; }

/* Enemy levels the player SEES on the card. index.html adds its own bonus from
   the difficulty string (+4 / +8) on top of this, so this is the visible part
   of the scaling, not the whole of it. */
export function enemyLevelFor(grip) { return Math.floor((grip|0) / 25); }

/* At full grip the Foundation doesn't just fight harder — it seals the site,
   the same way RLC_HEAT_SCP_LOCK seals surveillance nodes mid-run. */
export function isSealed(hold) {
  return !!(hold && hold.f === 'scp' && (hold.g|0) >= 90);
}
