/* 🧬 MISSION GENERATOR — a district + who holds it → a playable run.
   ═══════════════════════════════════════════════════════════════════════════
   Produces a campaign in EXACTLY the shape index.html's roguelite engine
   already eats (see _rlcBlankNode / _rlcBlankCampaign). Nothing downstream
   knows these were generated: rlcStartRun, rlcEnterNode, rlcStartBattle,
   the relics, the haul, the heat and the death stakes all run untouched.

   ⚠ WHY THE ID CARRIES THE WHOLE RECIPE.
     A run outlives the state that made it: the player can start a raid on
     Midtown, the map can tick while they're inside it, and _rlcCampaign()
     will still be asked to resolve run.campaignId on every node, every
     re-render and every reload. If generation read LIVE grip, the campaign
     would quietly change shape underneath an in-progress run.
     So the id is the recipe —

         msn_<site>_<faction|none>_<grip>_<day>

     — and generation is a pure function of it. Nothing to persist, nothing to
     invalidate, and a half-finished run survives a reload and a tick.
     ⚠ Every part is [a-z0-9] and separated by "_", so site and faction ids
       must never contain an underscore. parse() is the only reader.

   HAND-AUTHORED CAMPAIGNS ARE NOT REPLACED. A site with `campaignId` set
   points at a real authored campaign instead (that's what Gas Station Run is
   for). Generation is what makes forty districts viable without forty
   hand-built maps — not a replacement for the ones worth building by hand.
   ═══════════════════════════════════════════════════════════════════════════ */

import { hashStr } from './city.js';
import { bridge } from './bridge.js';
import { SITE_BY_ID, MISSION_POI, FACTIONS, difficultyFor, bandFor, enemyLevelFor } from './poi.js';

export const PREFIX = 'msn_';

export function missionId(siteId, hold, day) {
  return PREFIX + siteId + '_' + ((hold && hold.f) || 'none') + '_' + ((hold && hold.f) ? (hold.g|0) : 0) + '_' + (day|0);
}
export function parse(id) {
  if (typeof id !== 'string' || id.indexOf(PREFIX) !== 0) return null;
  const p = id.split('_');                       // msn, site, faction, grip, day
  if (p.length !== 5) return null;
  const site = SITE_BY_ID[p[1]];
  if (!site) return null;
  return { id, site, faction: p[2] === 'none' ? null : p[2], grip: parseInt(p[3],10)||0, day: parseInt(p[4],10)||0 };
}

/* Deterministic RNG — mulberry32 off the id's hash. Same id, same map. */
function rng(seed) {
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick  = (r, arr) => arr[Math.floor(r()*arr.length) % arr.length];
const range = (r, a, b) => a + Math.floor(r()*(b-a+1));

/* 🎲 RANDOM ENCOUNTERS — one table, weighted by who holds the ground.
   These ride on `event` nodes, which the engine already resolves; there is no
   parallel encounter system and there shouldn't be. */
const ENCOUNTERS = {
  any: [
    { name:'Collapsed Stairwell', text:'The only way down is a stairwell folded in on itself. You can dig, or take the long way around and lose the light.',
      choices:[{ label:'Dig through (−8% HP, +18 Cinder)', damagePercent:8, currency:18 }, { label:'Take the long way' }] },
    { name:'Survivor Cache',      text:'Someone walled a pantry off and never came back for it. Their handwriting is still on the tins.',
      choices:[{ label:'Take what you can carry (+22 Cinder)', currency:22 }, { label:'Leave it for whoever comes next' }] },
    { name:'Wounded Runner',      text:'A scout from another camp, bleeding out behind a planter. She has medicine on her and no way to use it.',
      choices:[{ label:'Patch her up (−1 med, she talks)', medPoints:-1, currency:26 }, { label:'Take the kit and go (+2 med)', medPoints:2 }] },
  ],
  scum: [
    { name:'Toll Crew',           text:'They have strung cable across the avenue and want a cut to lift it. They are not asking twice.',
      choices:[{ label:'Pay the toll (−20 Cinder)', currency:-20 }, { label:'Walk into it (−12% HP)', damagePercent:12 }] },
    { name:'Rigged Doorway',      text:'A Scum self-detonator has been sitting in that doorway long enough to stop breathing quietly.',
      choices:[{ label:'Back out slowly' }, { label:'Rush it (−15% HP, +30 Cinder)', damagePercent:15, currency:30 }] },
  ],
  anomalies: [
    { name:'The Room Repeats',    text:'You come through the door into the room you just left. Twice. The third time the furniture is wrong.',
      choices:[{ label:'Walk it until it breaks (−10% HP)', damagePercent:10 }, { label:'Go out the window (+14 Cinder)', currency:14 }] },
    { name:'Something Grew Here', text:'The stairwell is full of it. It moves when you are not looking at it, which is most of the time.',
      choices:[{ label:'Cut through (−14% HP)', damagePercent:14 }, { label:'Seal the door and reroute' }] },
  ],
  scp: [
    { name:'Checkpoint',          text:'Foundation barricade, two guards, a scanner. They are logging everything that walks past.',
      choices:[{ label:'Talk your way through' }, { label:'Go around through the service tunnels (−9% HP)', damagePercent:9 }] },
    { name:'Sealed Wing',         text:'Containment doors, still powered, still holding. Whatever is behind them is Foundation property.',
      choices:[{ label:'Leave it sealed' }, { label:'Crack the panel (+34 Cinder, −12% HP)', currency:34, damagePercent:12 }] },
  ],
};

/* Sample n reward keys from whatever the game says is deckable.

   ⚠ THE POOL IS LEGITIMATELY EMPTY ON A BARE INSTALL. Forge.useCustomOnlyPool
   is the production default and hides the built-in mockup cards, so until a
   catalogue is published getAllDeckableCards() returns nothing. That is not a
   bug to paper over — there are genuinely no cards to give. What WOULD be a
   bug is a run that silently pays nothing for it, so hasCards() lets the
   generator compensate in Cinder instead (see CARDLESS_CINDER below), and the
   map says plainly that no catalogue is published rather than leaving the
   player to notice empty reward screens. */
function cardPool() {
  try { return bridge().cardKeys() || []; } catch (e) { return []; }
}
export function hasCards() { return cardPool().length > 0; }
function rewardCards(r, n) {
  const pool = cardPool();
  if (!pool.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.floor(r()*pool.length) % pool.length]);
  return out;
}
/* What a card reward is worth in Cinder when there are no cards. Deliberately
   modest: it keeps a run from being pointless, it is not meant to make a
   card-less install the profitable way to play. */
const CARDLESS_CINDER = { battle: 14, elite: 26, finalBoss: 55 };

function healOptions() {
  return { options: [
    { name:'Patch up',      healPercent:25,  costMedPoints:1, costCurrency:0 },
    { name:'Field surgery', healPercent:50,  costMedPoints:2, costCurrency:0 },
    { name:'Full recovery', healPercent:100, costMedPoints:4, costCurrency:0 },
  ] };
}

/* ── the graph ───────────────────────────────────────────────────────────
   A lattice: one approach, a few rows of 1–3 nodes, one final objective.
   Every node past row 0 is guaranteed a parent, because a node with no
   incoming edge reads as a start node to _rlcStartNodes and would let the
   player skip the run. */
function layout(r, rows) {
  const grid = [[1]];
  for (let i = 1; i < rows - 1; i++) grid.push(range(r, 2, 3));
  grid.push(1);
  return grid.map(n => (typeof n === 'number' ? n : n[0]));
}

export function generate(id) {
  const m = parse(id);
  if (!m) return null;
  const { site, faction, grip } = m;
  const poi  = MISSION_POI[site.poi] || MISSION_POI.supermarket;
  const fac  = faction ? FACTIONS[faction] : null;
  const band = bandFor(site, grip);
  const r    = rng(hashStr(id));

  const cards = hasCards();
  const lvl  = 1 + enemyLevelFor(grip);
  const rows = poi.nodes + (grip >= 50 ? 1 : 0) + (grip >= 90 ? 1 : 0);
  const widths = layout(r, rows);

  // Build the rows first so connections can be wired with everything known.
  const byRow = [];
  let seq = 0;
  widths.forEach((w, row) => {
    const arr = [];
    for (let col = 0; col < w; col++) arr.push({ id:'n'+(seq++), row, col });
    byRow.push(arr);
  });

  /* What each node IS. The middle of the run gets one of everything that
     matters — somewhere to heal, somewhere to spend, and a convoy to bank at,
     because banking is what makes the death stakes a decision rather than a
     punishment. Elites and the heat-locking SCP node scale with grip. */
  const mid = [];
  byRow.forEach((arr, row) => { if (row > 0 && row < rows-1) arr.forEach(n => mid.push(n)); });
  const shuffled = mid.slice().sort(() => r() - 0.5);
  const assign = (type, n) => { for (let i=0; i<n && shuffled.length; i++) { const nd = shuffled.pop(); if (nd) nd._t = type; } };

  assign('medical', 1);
  assign('convoy',  1);                                  // bank the haul, cool the heat
  assign('market',  1);
  assign('event',   1 + (r() < 0.5 ? 1 : 0));
  assign('treasure', 1);
  if (grip >= 50) assign('elite', grip >= 90 ? 2 : 1);
  if (r() < 0.35) assign('randomEvent', 1);
  shuffled.forEach(n => { n._t = 'battle'; });           // everything left fights

  byRow[0][0]._t = 'rest';
  byRow[rows-1][0]._t = 'finalBoss';

  /* Wire it. Each node reaches 1–2 nodes on the next row; then any next-row
     node nobody reached gets adopted, so the lattice has no orphans. */
  for (let row = 0; row < rows-1; row++){
    const here = byRow[row], next = byRow[row+1];
    const reached = new Set();
    here.forEach(n => {
      n.connections = [];
      const want = Math.min(next.length, 1 + (r() < 0.45 ? 1 : 0));
      // prefer the node closest across, so edges read as a path not a web
      const order = next.slice().sort((a,b) =>
        Math.abs(a.col - n.col*(next.length/here.length)) - Math.abs(b.col - n.col*(next.length/here.length)));
      for (let i = 0; i < want; i++){ n.connections.push(order[i].id); reached.add(order[i].id); }
    });
    next.forEach(nd => {
      if (reached.has(nd.id)) return;
      const parent = here[Math.floor(r()*here.length) % here.length];
      parent.connections.push(nd.id);
    });
  }
  byRow[rows-1][0].connections = [];

  /* Dress each node. Names come from the POI and the holding faction so a
     supermarket run reads like a supermarket run. */
  const encPool = ENCOUNTERS.any.concat(faction ? (ENCOUNTERS[faction] || []) : []);
  const mobName = fac ? fac.mob : 'Scavenger Pack';
  const bossName = fac ? fac.foe : ('The ' + poi.label + ' Holdout');
  const BATTLE_NAMES = {
    school:['Gymnasium','Bus Lot','Cafeteria Stores'], supermarket:['Checkout Line','Loading Dock','Cold Store'],
    firehouse:['Apparatus Bay','Hose Tower','Bunk Room'], depot:['Container Yard','Signal Box','Turntable'],
    ironworks:['Casting Floor','Scrap Bins','Crane Gantry'], hospital:['Triage','Ward Nine','Pharmacy Stair'],
    substation:['Switchyard','Transformer Row','Control Room'], vault:['Deposit Floor','Teller Line','Cage Corridor'],
    scar:['Overgrown Mall','The Ramble','Reservoir Edge'],
  };
  const spots = BATTLE_NAMES[site.poi] || ['Ground Floor','Back Stair','Roof Access'];

  let scpMarked = false;
  const nodes = [];
  byRow.forEach(arr => arr.forEach(n => {
    const t = n._t;
    const node = {
      id: n.id, type: t, name: '', desc: '', row: n.row, col: n.col,
      connections: n.connections || [],
      enemyHeroId: '', enemyDeckId: '', enemyLevel: '',
      enemy: { name:'', hpOverride:'', modifierIds: [] },
      reward: { cardKeys: [], choiceCount: 3, allowSkip: false, currency: 0, medPoints: 0 },
      heal: healOptions(), shop: { name:'Scavenger Trade', items: [] },
      event: { text:'', choices: [] }, mystery: { outcomes: [] }, randomEvent: { pool: [] },
    };
    switch (t) {
      case 'rest':
        node.name = 'Approach'; node.desc = poi.flavour; break;
      case 'battle':
        node.name = pick(r, spots);
        node.enemy.name = mobName; node.enemyLevel = String(lvl);
        node.reward.cardKeys = rewardCards(r, 6);
        node.reward.currency = range(r, 12, 22) + Math.round(grip/6) + (cards ? 0 : CARDLESS_CINDER.battle);
        break;
      case 'elite':
        node.name = pick(r, spots) + ' — Held';
        node.enemy.name = (fac ? fac.name + ' Elite' : 'Elite Holdout');
        node.enemyLevel = String(lvl + 1);
        node.reward.cardKeys = rewardCards(r, 8);
        node.reward.currency = range(r, 26, 40) + Math.round(grip/4) + (cards ? 0 : CARDLESS_CINDER.elite);
        // 🔴 The Foundation's node is the one that SEALS. This flag is what
        // RLC_HEAT_SCP_LOCK reads mid-run: carry enough contraband past it and
        // the route closes, so smuggling becomes a routing decision.
        if (faction === 'scp' && !scpMarked) { node.scp = true; scpMarked = true; node.name = 'Foundation Checkpoint'; }
        // The Anomalies don't fight you so much as get into you.
        if (faction === 'anomalies' && grip >= 50) node.infectionZone = true;
        break;
      case 'finalBoss':
        node.name = poi.label;
        node.enemy.name = bossName;
        node.enemyLevel = String(lvl + 2);
        node.reward.cardKeys = rewardCards(r, 10);
        node.reward.currency = range(r, 60, 90) + grip + (cards ? 0 : CARDLESS_CINDER.finalBoss);
        break;
      case 'medical':  node.name = 'Aid Station'; break;
      case 'market':   node.name = 'Scavenger Trade'; break;
      case 'convoy':   node.name = 'Convoy Point'; node.desc = 'Bank the haul here. What you carry out of the district is not yours until you do.'; break;
      case 'treasure': node.name = 'Untouched Stockroom'; node.reward.currency = range(r, 20, 34); break;
      case 'randomEvent': node.name = 'Unmarked Door';
        node.randomEvent.pool = encPool.map(e => ({ text: e.text, choices: e.choices })); break;
      default: {                                          // 'event'
        const e = pick(r, encPool);
        node.name = e.name; node.event = { text: e.text, choices: e.choices };
        break;
      }
    }
    nodes.push(node);
  }));

  const held = fac ? (fac.name + ' hold this district — ' + grip + '% grip.') : 'Survivor ground. For now.';
  return {
    id, name: poi.label + ' — ' + site.name,
    description: poi.flavour + ' ' + held,
    intro: 'Field team moving on ' + site.name + '. Objective is the ' + poi.label.toLowerCase() +
           '. ' + held + ' Bank what you take at a convoy point — die out there and it stays out there.',
    coverImg: '',
    // 🔑 THE ONE FIELD THAT CARRIES THE FACTION PRESSURE. index.html reads it
    // twice — _rlcDiffBand for what the run drops, _rlcDiffBonus for +4/+8
    // enemy levels — so a held district paying better AND fighting harder
    // costs exactly this string and no engine changes.
    difficulty: difficultyFor(site, grip),
    startingHeroId: '', startingHP: 100,
    currencyName: 'Cinder',
    startingCurrency: 20, startingMedPoints: 2,
    startingDeckMode: 'player', startingDeckId: '',
    startingDeckChoices: [], draftPool: [], draftPicks: 15, draftChoices: 3,
    requiresCampaignId: '',
    // 📍 'hidden' keeps every generated mission OFF the roguelite campaign
    // list — the map is their only surface, and _frButtonOnlyCampaign-style
    // clutter is exactly what placement exists to prevent.
    placement: 'hidden',
    isPublished: true, isBuiltIn: true, isGenerated: true,
    _band: band.key, _site: site.id, _faction: faction, _grip: grip, _noCards: !cards,
    nodes,
    finalReward: { cardKeys: rewardCards(r, 3), currency: 40 + grip + (cards ? 0 : 60) },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}
