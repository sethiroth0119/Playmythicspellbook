/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · plan.js — "is this for me?"

   The owner's goal ends with: "Then gives them a plan so players can know if it
   is for them." This file answers that for every node on the map: the 27 tiles,
   the four systems and the two channels. One call, one plain object, all words
   a modal can print as they are.

   WHY THE NUMBERS ARE NOT IN HERE
   Every figure in a plan (what it costs, what a full crew brings in, what the
   payroll takes, how long it takes to pay back, how much feedstock an hour of
   running burns) is ARITHMETIC OVER THE INJECTED opEcon ROW — the same row
   _opEcon() hands the game, so a published admin override moves the plan with
   it. Change the row and the plan changes; pass no row and every figure is
   null and every sentence says "unknown". Nothing is remembered, nothing is
   defaulted, nothing is rounded toward a number somebody once read in a table.
   The formula is the game's own (_opComputed), held at its neutral point:
     gross  = workers x ratePerWorkerHr        (market, standing, supply, site = 1)
     salary = workers x salaryPerWorkerHr
     net    = max(0, gross - salary)           payback = startup / net
   and the plan SAYS "at full crew, neutral market" beside every one of them,
   because a real collect is multiplied by a market that swings and a supply
   ratio that falls when the stock room is empty.
   Rejected: a "typical earnings" table. It would be right on the day it was
   typed and a lie after the first retune — the Cinder Forge lesson.

   WHY LIVE AND PLANNED NEVER SHARE A SENTENCE
   The map is the owner's intent; the game is not the map yet. Transport is
   optional today (except two medical lanes), most loot needs are proposals and
   two tiles do not exist. A plan that says "hire a carrier" without saying
   "nothing makes you, yet" would send a player to pay for something the game
   does not ask for. So every resource, partner, step and risk carries `live`,
   and the text itself says which it is.

   WHY THERE IS AN AUTHORED TABLE AT ALL (NOTES, below)
   What a business FEELS like — whether it opens a screen you play or is a
   licence you staff and collect — is in no data file; it lives in
   COMPANY_PAGES and _opAfterFound. Without it every tile's advice collapses
   into the same paragraph with the nouns swapped, which is exactly what the
   bar forbids. NOTES holds words only: not one quantity, price or rate.

   PURE. The only import is tuning.js (pure data). Sibling data — businesses,
   recipes, coverage, loot, shipping, catalog, and partners when the caller has
   it — arrives in `data`; every reader below tolerates a module namespace, the
   bare table, or nothing at all. Every export is total: a bad argument gets a
   thinner plan, never a throw.
   ════════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';

/* Said beside every derived figure. One constant so a view can print it once
   as a footnote and a test can grep for it. */
export const PLAN_BASIS = 'at full crew, neutral market';

/* Display-only knobs. They read SC.plan first so the seam can take them over
   without a change here; the fallbacks are list lengths, never economy. */
const P = (SC && SC.plan) || {};
const MAX_STEPS = P.maxSteps || 6;
const MAX_RISKS = P.maxRisks || 4;
const MAX_FIT = P.maxFit || 3;
const MAX_PLANNED_NEEDS = P.maxPlannedNeeds || 5;
/* List lengths again, never economy. A Hospital has six live screen inputs and
   the Foundry sixteen: the card shows the few that matter most and NAMES the
   rest in one line, so a Trash Crusher plan is not a wall of ore. */
const MAX_SCREEN_NEEDS = P.maxScreenNeeds || 6;
const MAX_PER_SOURCE = P.maxPerSource || 3;
const MAX_DERIVED_SUPPLIERS = P.maxDerivedSuppliers || 2;
/* ROUND 6. `plan.brief` — a mid-length tier between summary and the full
   plan — is GONE. It was never in the lead contract, and a grep of every module
   in this folder found no reader: modal.js prints plan.summary, plan.steps,
   fitFor/notFor, risks, earn and verdictFor, and nothing at all prints .brief.
   It was output proved only by its own harness, so its word-count knobs and
   sentence-trimming helpers went with it. A view that wants one screen should
   print plan.summary plus the first three steps — both of which a player
   actually sees today. */
/* ROUND 6 — the critic's gap. These five bands decide every verdict the plan
   gives ("Yes — start it" vs "Not yet — save up first"), and plan.js used to
   keep a fallback copy of each. That is exactly the anti-pattern tuning.js
   records against proposal.js: the governing number living outside the settings
   file, where a retune never reaches it. There is no fallback now. Without
   SC.plan every band is null and each line that would have used one degrades to
   "unknown" — the same honest degradation as a missing opEcon row, never a
   guess. The list-length knobs above keep their defaults on purpose: how many
   bullet points fit on a card is not a decision about the economy. */
const band = (v) => (v && typeof v === 'object' ? v : null);
const AFFORD = band(P.afford);
const MARGIN = band(P.margin);
const INPUTS_HELD = band(P.inputsHeld);
const DEPENDENCY = band(P.dependency);
const STAFFING = band(P.staffing);

/* ── PLAYSTYLES ─────────────────────────────────────────────────────────────
   Mapped from the PDF, not invented: the four "Best Buyers" lines (p2-p5) name
   Business Players, City Builders, Trainers/Battlers and Business owners; the
   legend (p6) adds the three "best to make money" routes (Marketplace,
   Transport, Car Marketplace) and the battler card. `pdf` says which. The last
   two are about HOW a player wants to spend time, which the PDF does not draw
   but every "is it for me" question turns on. */
export const PLAYSTYLES = Object.freeze([
  { id: 'battler', label: 'Battler', blurb: 'You fight, you bring loot home, you want your deck stronger.', pdf: 'legend card icon: "Good For Battlers and camp training"; p4 Best Buyers "Trainers/Battlers"' },
  { id: 'trainer', label: 'Camp trainer', blurb: 'You level units at camp and send them on missions.', pdf: 'legend card icon; p4 Best Buyers "Trainers/Battlers"; p5 Camp' },
  { id: 'trader', label: 'Trader', blurb: 'You buy and sell on the Marketplace and watch prices.', pdf: 'legend: "Marketplace: Best to make money" and "Car Marketplace: Best to make money"' },
  { id: 'builder', label: 'City builder', blurb: 'You run a city and want what it needs on tap.', pdf: 'p3 Best Buyers "City Builders"; p4 City Builder' },
  { id: 'hauler', label: 'Hauler', blurb: 'You want to be the one every shipment depends on.', pdf: 'legend: "Transport: Best to make money"; Transport hub on p6-p8' },
  { id: 'investor', label: 'Passive investor', blurb: 'You want Cinder ticking over while you do something else.', pdf: 'not drawn; p4 "generating passive Cinder income for its owner"' },
  { id: 'operator', label: 'Hands-on operator', blurb: 'You want a screen to play, not just a number to collect.', pdf: 'not drawn; p3 "essential city resources and items are crafted"' },
].map(Object.freeze));
const STYLE = Object.freeze(Object.fromEntries(PLAYSTYLES.map((s) => [s.id, s])));

/* ── NOTES — what owning it is like. WORDS ONLY. ─────────────────────────────
   door  = what the licence opens in the shipped game (live, cited by symbol).
   plays = true when that door is a screen the player actively runs.
   day   = the honest one-line description of the work.
   risk  = a caveat no data file can derive.
   client / clientLive = what a SERVICE tile calls the people it serves (a bank
           has borrowers, a warehouse tenants — neither "buys cargo").
   next  = the second business worth pairing with a tile that makes nothing to
           hold, so "burn what you have spare" is never said to a Dojo.
   income = ROUND 4. Set on the tiles whose hourly yield is NOT what the business
           sells. Round 3 built "hire a carrier for your X" and "first sale: X"
           from the op's yield row alone, and told a Car Dealer owner to list
           Metal on the Car Marketplace and a Car Factory owner that the first
           thing to sell is Supplies. What these two trade in is a VEHICLE ITEM
           (recipes.js marks those lanes cargoIsItem), which no yield row holds.
           sells = the thing, title = the step-5 heading, detail = what to do,
           live = whether that sale works today, byproduct = what the yield is.
   Cites name symbols, not lines: index.html is being edited by other sessions. */
const CP = 'COMPANY_PAGES (public/corp/shell.jsx)';
const AF = '_opAfterFound (public/index.html)';
const NOTES = Object.freeze({
  transport: { plays: true, screen: 'the Freight Depot', door: 'the Haulage Board and the Freight Depot (carriers, tariffs, rigs); founding grants a starter rig once per account', cite: CP + '; ' + AF,
    day: 'You accept other players\' haul requests, run them on your rigs and are paid on arrival. More rigs come off the Car Dealer\'s floor.',
    who: 'the player who wants to sit in the middle of everybody else\'s business' },
  mining: { plays: false, door: null, cite: CP,
    day: 'Found it, staff it, collect. It is the root of the map: it needs nobody and half the map needs it.',
    who: 'a first business — nothing to stock, nothing to learn' },
  oil: { plays: true, door: 'Black River Petroleum and The Cracking Yard, where crude is cracked into drums of naphtha, diesel, kerosene and the rest', cite: CP + '; STASH_IDS (public/src/refinery/state.js)',
    day: 'The operation pumps fuel on its own; the refinery screen is where the long list of oil products comes from, and that part is hands-on.',
    who: 'someone who likes a production puzzle and wants many different things to sell' },
  gas: { plays: true, door: 'Ethos Fuel Command', cite: CP,
    day: 'A steady fuel pump with a forecourt screen. Fuel is the one thing almost every other business burns, so there is always a buyer.',
    who: 'a supplier who wants the widest possible customer list' },
  cars: { plays: true, door: 'Prince Portfolios (the vehicle auction floor) and the Dealer Desk for player-built cars', cite: CP + '; ' + AF,
    day: 'You work an auction floor: buy vehicles, sell them on to battlers, hauliers and other players.',
    who: 'a dealer at heart — this is a trading desk with cars on it',
    income: { sells: 'vehicles, bought and sold on its auction floor', title: 'the auction floor', live: true, byproduct: 'trade-in scrap', handover: 'handed over as an item, never loaded as cargo',
      detail: 'Buy a vehicle on the Prince Portfolios floor and sell it on: to a Transport owner who needs a rig, to a battler, or on the player-to-player Car Marketplace. A vehicle changes hands as an item on the floor, not as cargo on a truck.' },
    risk: { title: 'The Car Factory hand-off is not live', detail: 'The Dealer Desk resale of player-built cars depends on server functions that have not been applied anywhere yet, so today your stock comes from the auction floor, not from a Car Factory partner.', live: true } },
  construction: { plays: false, door: 'the Construction licence — every worker is one more city build slot', cite: 'OPS_ECON.construction; CITY_LICENSES (public/index.html)',
    day: 'It makes your own city build faster. The Cinder is a side effect; the build slots are the point.',
    who: 'anyone who runs a city, before almost anything else',
    income: { sells: 'build slots for your own city', title: 'a faster city', live: true, byproduct: 'site salvage', handover: 'used in your own city, never loaded as cargo',
      detail: 'Every worker you hire is one more city build slot, so the first thing this business pays you is time: your own city goes up faster. There is nothing to list in that — the slots are yours alone.' } },
  trashcrusher: { plays: true, door: 'the Trash Crusher / Foundry screen and "Post a Scrap Run" on the Haulage Board', cite: CP,
    day: 'Three recyclates come out on their own; the foundry screen turns scrap into metal stock if you feed it.',
    who: 'a supplier to builders and factories who does not mind getting their hands dirty' },
  weaponsmith: { plays: true, door: 'the Weapon Smith bench, where parts are forged into weapons for units', cite: CP + '; ' + AF,
    day: 'The operation turns metal into weapon parts; the bench turns weapon parts, wood and cloth into gear battlers actually equip.',
    who: 'a battler who wants to make their own kit, or sell it to other battlers',
    battler: 'its bench forges the weapons your units carry' },
  restaurant: { plays: true, door: 'the Mythic Kitchen, and player-to-player food convoys', cite: CP,
    day: 'It eats food and pays Cinder, and owning one multiplies the food every food business you own brings in.',
    who: 'someone who already owns (or is about to own) a farm, a cannery or a fishing company' },
  agri: { plays: false, door: null, cite: CP,
    day: 'Found it, staff it, collect food. Food is a staple half the map eats.',
    who: 'a first business with a product everyone recognises' },
  feed: { plays: true, door: 'the Homestead Farm — animals, eggs, wool, hides, cloth and manure', cite: CP + '; FARM_ECON (public/src/farm/index.js)',
    /* Two names for one business confused round 3's readers: the tile is Home
       Feed, the screen it opens is the Homestead Farm. Said once, here. */
    day: 'The operation mills feed on its own; the Homestead Farm is the screen this business opens — a real farm you tend, and where most of the product list comes from.',
    who: 'a player who wants a farm to look after, and has the patience for a slow payback' },
  dojo: { plays: true, door: 'the Tutor Shop wholesale licence and the Dojo Shop at camp, where you resell moves to other battlers', cite: AF,
    day: 'A small licence. Its value is the shop it opens, not the hourly rate.',
    who: 'a battler who already knows which moves other players want',
    next: { id: 'cardshop', why: 'the same battlers who buy moves from your Dojo Shop buy cards, so one customer list pays twice' },
    battler: 'its Dojo Shop is where battlers buy moves for their units' },
  cardshop: { plays: true, door: 'your own Card Shop storefront', cite: AF,
    day: 'A small licence that turns you into a card retailer.',
    who: 'a collector who trades cards anyway and wants a shop front for it',
    next: { id: 'dojo', why: 'the battlers who buy your cards also buy moves, so one customer list pays twice' },
    battler: 'it sells the cards decks are built from' },
  fishing: { plays: true, door: 'Woods Fishing, with a free skiff and crew on founding', cite: CP + '; ' + AF,
    day: 'The operation lands fish on its own; the fishing screen is there when you want to cast a line yourself.',
    who: 'a relaxed producer with a clear first customer (the cannery and the restaurant)' },
  cannery: { plays: false, door: null, cite: CP,
    day: 'Fresh fish in, food out. It is a converter: without fish at the gate it slows to a crawl.',
    who: 'someone who owns a Fishing Company or has a reliable one to buy from' },
  bank: { plays: true, door: 'Bank Row at the camp: a chartered player bank that takes deposits and underwrites loans', cite: 'player_banks; bank_open_cinder (public/index.html)',
    day: 'You lend other players Cinder and live on the interest. It ships nothing and makes nothing.',
    who: 'a patient player with a lot of Cinder and a feel for who pays back',
    client: 'borrower', clientLive: 'chartered player banks take deposits and lend today',
    next: { id: null, why: 'A bank makes nothing another business can burn, so choose your second business on its own plan. The ones whose plan says Passive investor sit best beside a loan book, because lending is the part that needs your attention' },
    fit: [['trader', 'a bank is trading in Cinder itself — deposits in, loans out, interest kept — so a feel for price and risk is the whole job.']],
    risk: { title: 'Borrowers can fail to pay', detail: 'The income beyond the base rate is interest on loans to real players. A bad loan is your loss.', live: true } },
  genelab: { plays: true, door: 'the licence for the camp DNA Lab, where battlers clone units', cite: AF,
    day: 'It turns medicine into DNA. DNA is what cloning costs, so your customers are battlers and trainers.',
    who: 'a trainer who burns DNA at camp and would rather make it than hunt it',
    battler: 'it makes the DNA that cloning a unit costs' },
  medical: { plays: true, door: 'The Hospital — patients, bandages, and pharma compounded for wholesale', cite: CP + '; public/src/hospital',
    day: 'The operation makes medicine on its own; the hospital screen is a full game on top, and its wholesale is the one place a carrier is already mandatory.',
    who: 'a hands-on player who wants the deepest business screen in the game' },
  research: { plays: true, door: 'the Containment Lab', cite: CP + '; public/src/biolab',
    day: 'Expensive, slow, and it makes Memory Shards — the rare staple battlers and labs both want.',
    who: 'a late-game owner who already has metal and fuel coming in',
    battler: 'it makes Memory Shards, which you otherwise have to win off bosses' },
  carfactory: { plays: true, door: 'the Car Factory 3D line, where you place parts and build a car', cite: CP + '; public/src/carfactory',
    /* ROUND 5: this read "The operation makes supplies on its own" — which is
       true of the hourly yield and wrong about the tile. What the Car Factory
       IS is the build line; Supplies is what falls off it. */
    day: 'You build a car part by part on its 3D line; the hourly operation turns out Supplies on the side while you do.',
    who: 'a builder who wants to make a thing and see it sold',
    income: { sells: 'a car you build on its line', title: 'the hourly rate, while the car sale waits', live: false, byproduct: 'line offcuts', handover: 'handed over as an item, never loaded as cargo',
      detail: 'Build your first car on the line now; that half is live. Selling it through a Car Dealer is the whole point of this tile and is PLANNED: it is not live yet, so the first Cinder you see is the hourly rate of the operation.' },
    battler: 'the map\'s own words: dealers sell its vehicles to players for battles and delivery missions',
    risk: { title: 'Selling a built car is not live yet', detail: 'The server half of the Car Factory has not been applied anywhere, so a built car cannot yet be sold through a dealer. Today the business earns from its hourly rate and its supplies.', live: true } },
  smuggling: { plays: false, door: null, cite: CP,
    day: 'Fuel in, Cinder out. It makes no resource at all today, so nobody on the map depends on you and you depend on nobody but a fuel seller.',
    who: 'a player who wants the Cinder and none of the logistics' },
  salvage: { plays: false, door: null, cite: CP,
    day: 'Found it, staff it, collect metal. The cheapest way to have metal coming in.',
    who: 'a first or second business, especially beside anything that burns metal' },
  warehouse: { plays: true, door: 'the Warehouse office, player-to-player storage rental and the first-person forklift yard', cite: CP + '; public/src/storage',
    day: 'Your product is space. Other players rent it; the more crew, the more space.',
    who: 'a landlord: low hourly rate, steady tenants',
    client: 'tenant', clientLive: 'player-to-player storage rental works today',
    next: { id: 'transport', why: 'goods reach a stock room on a truck, so one owner with both halves of logistics can offer a producer haulage and storage in a single deal' },
    fit: [['hauler', 'storage and haulage are the two halves of logistics: every lane on this map ends in somebody\'s stock room, and carriers are your natural partners.']] },
  bus: { plays: false, door: 'the city transit layer: bus stops and routes', cite: 'public/src/transit',
    day: 'It works only for your city. Fares are clamped so they can never turn a profit; the income is the operation\'s own rate.',
    who: 'a city owner who wants residents and NPC trade to reach other cities and camps',
    next: { id: 'rail', why: 'it is the other city-transit licence — stations and track for the same city once it has outgrown bus routes' },
    risk: { title: 'Outside a city it does nothing', detail: 'This is a city utility. It carries no business cargo and is never a stand-in for the Transport company.', live: true } },
  rail: { plays: false, door: 'train stations and rail track in your city', cite: 'public/src/transit',
    day: 'The biggest licence on the map, for the biggest cities. Same city-only role as the Bus Company.',
    who: 'an established city owner — nobody else',
    next: { id: 'bus', why: 'it is the other city-transit licence, and bus routes are what bring residents to your stations' },
    risk: { title: 'Outside a city it does nothing', detail: 'This is a city utility. It carries no business cargo and is never a stand-in for the Transport company.', live: true } },
  fashion: { planned: true, decision: 'D4',
    would: 'Turn fibre, wool and hides into cloth, fabric and clothing, and ship them through Transport — the owner\'s own example is cloth to the Medical Corporation, whose Hospital already uses cloth for bandages.',
    today: 'Cloth already exists: it drops in battle, and Home Feed makes it on its Homestead Farm screen. To try the idea today, collect cloth and sell it to Medical Corporation owners.' },
  airport: { planned: true, decision: 'D5',
    would: 'A third city-transit licence beside the Bus Company and the Rail Road: long-range NPC trade with other cities and camps, and the third way to satisfy the map\'s rule that a city needs a Bus, Airport or train station to hire from camps.',
    today: 'The Bus Company and the Rail Road exist today and fill the same role. The hiring rule itself is not enforced yet, so nothing is blocked by the Airport being missing.' },
});

/* ── small total helpers ──────────────────────────────────────────────────── */
const isObj = (v) => v !== null && typeof v === 'object';
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v) => { const n = fin(v); return n !== null && n > 0 ? n : null; };
const fn = (o, k) => (isObj(o) && typeof o[k] === 'function' ? o[k] : null);
const safe = (f, dflt) => { try { const v = f(); return v === undefined ? dflt : v; } catch (_) { return dflt; } };
const own = (o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const uniq = (a) => Array.from(new Set(a));
const UNKNOWN = 'unknown';
/* One number format for the whole plan. Whole Cinder; one decimal only when the
   figure is small enough for the decimal to matter (hours, feedstock). */
const fmt = (n) => {
  const v = fin(n); if (v === null) return UNKNOWN;
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return r.toLocaleString('en-US');
};
const list = (a, conj) => {
  const x = a.filter(Boolean); const c = conj || 'and';
  if (x.length <= 1) return x.join('');
  return x.slice(0, -1).join(', ') + ' ' + c + ' ' + x[x.length - 1];
};
/* 'a Oil Company owner' reads as a typo on the one screen meant to be read aloud. */
const aan = (w) => (/^[aeiou]/i.test(String(w)) ? 'an ' : 'a ') + w;
const hoursWords = (h) => {
  const v = fin(h); if (v === null) return UNKNOWN;
  if (v < 1) return 'under an hour';
  /* Days are arithmetic on hours, not an economy figure. */
  return v >= 48 ? 'about ' + fmt(v) + ' hours (' + fmt(v / 24) + ' days) of running' : 'about ' + fmt(v) + ' hours of running';
};

/* ── readers over the injected data (namespace, bare table, or nothing) ───── */
function bizRows(data) {
  const b = data && data.businesses;
  if (Array.isArray(b)) return b;
  if (isObj(b) && Array.isArray(b.BUSINESSES)) return b.BUSINESSES;
  return [];
}
const bizRow = (data, id) => bizRows(data).find((r) => r && r.id === id) || null;
function sysRow(data, id) {
  const b = data && data.businesses;
  const rows = isObj(b) ? [].concat(Array.isArray(b.SYSTEMS) ? b.SYSTEMS : [], Array.isArray(b.CHANNELS) ? b.CHANNELS : []) : [];
  return rows.find((r) => r && r.id === id) || null;
}
function recipeMap(data) {
  const r = data && data.recipes;
  if (isObj(r) && isObj(r.RECIPES)) return r.RECIPES;
  return isObj(r) ? r : {};
}
const recipeOf = (data, id) => { const r = own(recipeMap(data), id); return isObj(r) ? r : null; };
/* The lane behind a PDF needs-icon, whichever way it points. Local twin of
   recipes.pdfEdge so a caller that injects the bare RECIPES table still works. */
function laneBetween(data, needer, needed) {
  const f = fn(data && data.recipes, 'pdfEdge');
  if (f) { const e = safe(() => f(needer, needed), null); if (e) return e; }
  const a = recipeOf(data, needer); const hitA = a && Array.isArray(a.buys) ? a.buys.find((l) => l && l.from === needed) : null;
  if (hitA) return Object.assign({}, hitA, { to: needer, direction: 'supplier' });
  const b = recipeOf(data, needed); const hitB = b && Array.isArray(b.buys) ? b.buys.find((l) => l && l.from === needer) : null;
  if (hitB) return Object.assign({}, hitB, { to: needed, direction: 'buyer' });
  return null;
}
/* Who puts an id in a PLAYER's stash today. A city firm's output never leaves
   the closed city economy, so it is not a supplier a player can buy from. */
function stashProducers(data, resId) {
  const R = recipeMap(data);
  return Object.keys(R).filter((b) => isObj(R[b]) && Array.isArray(R[b].makes) && R[b].makes.some((m) => m && m.id === resId && m.live && m.via !== 'cityFirm'));
}
function catRow(data, id) {
  const c = data && data.catalog;
  const f = fn(c, 'byId'); if (f) return safe(() => f(id), null) || null;
  const arr = Array.isArray(c) ? c : (isObj(c) && Array.isArray(c.CATALOG) ? c.CATALOG : null);
  return arr ? arr.find((r) => r && r.id === id) || null : null;
}
const hasCatalog = (data) => !!(data && data.catalog);
const resName = (data, id) => { const r = catRow(data, id); return (r && r.name) || id; };
const resIcon = (data, id) => { const r = catRow(data, id); return (r && r.icon) || ''; };
/* Phantom ids (gunOil and friends) are in OPS_ECON but in no catalogue. They are
   reported as a risk and never offered as a need or a product. */
const realRes = (data, id) => (hasCatalog(data) ? !!catRow(data, id) : true);

/* opEcon may be the bridge function, a table keyed by op id (the fixture), or
   the one row for this tile. Anything else is "no row". */
const looksLikeRow = (o) => isObj(o) && ('ratePerWorkerHr' in o || 'startup' in o || 'maxWorkers' in o);
function rowOf(opEcon, id, selfId) {
  if (typeof opEcon === 'function') { const r = safe(() => opEcon(id), null); return looksLikeRow(r) ? r : null; }
  if (looksLikeRow(opEcon)) return id === selfId ? opEcon : null;
  const r = own(opEcon, id); return looksLikeRow(r) ? r : null;
}
function heldOf(held, id) {
  if (typeof held === 'function') return fin(safe(() => held(id), null));
  if (isObj(held)) return fin(own(held, id));
  return null;
}
function ownsOf(owns, id) {
  if (typeof owns === 'function') return safe(() => owns(id), false) === true;
  if (Array.isArray(owns)) return owns.indexOf(id) >= 0;
  if (owns instanceof Set) return owns.has(id);
  if (isObj(owns)) return own(owns, id) === true;
  return false;
}

/* ── whereToFind — loot.js words, never ours ─────────────────────────────── */
/* Tiles the owner's map has making this id but which do NOT put it in a
   player's stash today: a planned product, or one that exists only inside a
   city's economy. Round 1 sent 48 needs to "a lucky pull, so buy it" without
   saying from whom; when the map HAS a maker the player deserves its name and
   the honest tense ("would come from ... once that line is live"). */
function plannedProducers(data, resId) {
  const R = recipeMap(data);
  return Object.keys(R).filter((b) => isObj(R[b]) && Array.isArray(R[b].makes) && R[b].makes.some((m) => m && m.id === resId && (!m.live || m.via === 'cityFirm')));
}
function whereToFind(data, resId, selfId, labelOf) {
  const f = fn(data && data.loot, 'sourcesFor');
  const makers = stashProducers(data, resId).filter((b) => b !== selfId);
  const later = makers.length ? [] : plannedProducers(data, resId).filter((b) => b !== selfId);
  const buy = makers.length ? 'Or buy it from ' + list(makers.slice(0, 3).map((b) => aan(labelOf(b)) + ' owner'), 'or') + '.'
    : later.length ? 'No business puts it in a player\'s stash today; on the owner\'s map it would come from ' + list(later.slice(0, 2).map((b) => aan(labelOf(b))), 'or') + ' once that line is live.' : '';
  const base = { madeBy: makers, wouldBeMadeBy: later, noMaker: !makers.length && !later.length };
  if (!f) return Object.assign(base, { text: (buy || 'Where it drops is not known here (the loot table was not supplied).'), label: null, how: '', tail: buy, source: null, system: null, lootable: null, aimable: null });
  const rows = safe(() => f(resId, { catalog: data.catalog }), []) || [];
  const real = rows.filter((r) => r && !r.unverified && !r.notLootable);
  if (!real.length) {
    const m = rows.find((r) => r && r.notLootable);
    const how = m ? m.how : 'No battle or camp source is recorded for it.';
    const tail = buy ? buy.replace(/^Or buy/, 'Buy') : '';
    return Object.assign(base, { text: how + (tail ? ' ' + tail : ''), label: null, how, tail, source: m ? m.id : null, system: null, lootable: false, aimable: false, madeBy: uniq(makers.concat(m && m.madeByBiz ? [m.madeByBiz] : [])) });
  }
  const top = real[0];
  const also = real.slice(1, 3).filter((r) => r.via !== 'all' && r.via !== 'exotic').map((r) => r.label);
  const lottery = top.via === 'exotic' || top.via === 'all';
  const how = top.how + (also.length ? ' Also: ' + list(also) + '.' : '')
    + (lottery ? ' There is no place to aim for it — it is a lucky pull' + (makers.length ? ', so buying it is the realistic route.' : later.length ? '.' : ', and no other business on the map makes it, so loot is the only source.') : '');
  /* When the only drop is a lottery and a business MAKES it, the maker is the
     answer and the lottery the footnote — round 2 led every Wool row with a
     paragraph about exotic salvage and ended on the one useful clause. */
  const lead = lottery && makers.length ? buy.replace(/^Or buy/, 'Buy') : '';
  return Object.assign(base, { text: (lead ? lead + ' ' : '') + top.label + ': ' + how + (buy && !lead ? ' ' + buy : ''), label: top.label, how, tail: lead ? '' : buy, lead, source: top.id, system: top.system || null, lootable: top.kind !== 'buy', aimable: !lottery });
}
/* A modal is not a wall. loot.js rightly repeats a caveat on every row it
   applies to (the camp-trader restock warning, the exotic-salvage explainer),
   and round 1 printed the trader one three times in the Mining plan alone. A
   sentence that two or more rows of ONE plan share is lifted out, said once as
   a note naming the rows it covers, and each row keeps only what is its own.
   `whereFull` always holds the untouched text. */
const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
function foldRepeats(rows) {
  /* The FIRST sentence of a source says what the place is. It is never moved to
     a footnote (a row reading just "Church ruins." helps nobody): the first
     row to use a source describes it and later rows point back at that row.
     Only the sentences AFTER it — the caveats — are pooled into notes. */
  const count = new Map(); const firstUse = new Map();
  /* A short shared sentence ("Also: The Apothecary.") costs less on the row
     than as a footnote; only a real caveat is worth lifting out. Characters of
     prose, not an economy figure. */
  const NOTE_MIN_CHARS = 60;
  for (const r of rows) sentences(r._how).slice(1).forEach((x) => { if (x.length >= NOTE_MIN_CHARS) count.set(x, (count.get(x) || 0) + 1); });
  const shared = new Map();
  for (const r of rows) {
    const all = sentences(r._how); const head = all[0] || ''; const keep = [];
    for (const x of all.slice(1)) {
      if (count.get(x) > 1) { if (!shared.has(x)) shared.set(x, []); if (shared.get(x).indexOf(r.name) < 0) shared.get(x).push(r.name); } else keep.push(x);
    }
    const key = (r._label || '') + '|' + head; const seenIn = r._label && head ? firstUse.get(key) : null;
    if (r._label && head && !seenIn) firstUse.set(key, r.name);
    r.whereFull = r.whereToFind;
    const folded = (seenIn ? r._label + ' — the same place as ' + seenIn + '.' + (keep.length ? ' ' + keep.join(' ') : '')
      : (r._label ? r._label + ': ' : '') + [head].concat(keep).filter(Boolean).join(' ')) + (r._tail ? ' ' + r._tail : '');
    r.whereToFind = ((r._lead ? r._lead + ' ' : '') + folded).trim() || r.whereFull;
    delete r._how; delete r._label; delete r._tail; delete r._lead;
  }
  /* Sentences covering the same rows travel together as one note. */
  const byRows = new Map();
  for (const [x, who] of shared) { const k = who.join('|'); if (!byRows.has(k)) byRows.set(k, { appliesTo: who, parts: [] }); byRows.get(k).parts.push(x); }
  return Array.from(byRows.values()).map((n) => ({ appliesTo: n.appliesTo, text: 'About ' + list(n.appliesTo) + ': ' + n.parts.join(' ') }));
}

/* What a live sub-screen edge is FOR, in a player's words. coverage.js cites
   the code symbol (the bandage recipe, the treat cost, the bench table) because
   its reader is the audit; a player gets the noun, or nothing. Words only. */
function purposeOf(why) {
  const t = String(why || '');
  if (/bandage/i.test(t)) return 'bandages';
  if (/fleet upkeep/i.test(t)) return 'keeping your rigs on the road';
  if (/repair/i.test(t)) return 'repairs';
  if (/treat/i.test(t)) return 'treating sick animals';
  if (/kitchen/i.test(t)) return 'the dishes you cook';
  if (/foundry/i.test(t)) return 'the metal stock you pour';
  if (/pharma|hospital inputs/i.test(t)) return 'the pharma lines you compound';
  if (/bench/i.test(t)) return 'what you make at the bench';
  return null;
}

/* ── THE TRANSPORT RULE, AS THE GAME STANDS TODAY ────────────────────────────
   ROUND 4. Rounds 1-3 typed the first rung of the carrier rule, benefits and all,
   into four sentences as if it were permanent. That is the PHASE 1 rung of the
   gating ladder in public/src/transport/routes.js; the day that constant moves,
   every plan would state a stale rule with full confidence. shipping.js already
   owns both halves — effectivePhase(ctx) and PHASE_LADDER as data — so the
   words are assembled from the rung the game is ON, and the caller may pass
   `transportPhase` (the bridge's accessor; a number or a thunk), which
   shipping.js can lower but never raise. No shipping module injected = the plan
   says it does not know, rather than assuming rung one. */
function transportRule(o) {
  const sh = (o.data || {}).shipping;
  const ep = fn(sh, 'effectivePhase'); const ladder = isObj(sh) && Array.isArray(sh.PHASE_LADDER) ? sh.PHASE_LADDER : null;
  const unknown = { phase: null, known: false, optional: null, market: '', today: 'Whether the game makes you hire a carrier today was not available here; the Haulage Board shows the live rule.',
    sentence: 'Whether the game makes you hire a carrier today was not available here; the Haulage Board shows the live rule.',
    short: 'whether a carrier is required today was not available here', risk: 'The owner\'s goal is for every business-to-business shipment to need a carrier; how far the game enforces that today was not available here.' };
  if (!ep || !ladder || !ladder.length) return unknown;
  const raw = typeof o.transportPhase === 'function' ? safe(() => o.transportPhase(), null) : o.transportPhase;
  const phase = safe(() => ep(Number.isInteger(raw) && raw > 0 ? { transportPhase: raw } : undefined), null);
  const rung = ladder.find((r) => r && r.phase === phase) || null;
  if (!rung) return unknown;
  const optional = rung === ladder[0]; const last = rung === ladder[ladder.length - 1];
  const stage = 'stage ' + (ladder.indexOf(rung) + 1) + ' of ' + ladder.length + ' ("' + rung.name + '")';
  /* The first rung is the only one where "every shipment needs a carrier" is
     wholly the owner's plan; from the second rung on part of it is the game. */
  const sentence = optional
    ? 'PLANNED: today hiring a carrier is optional — the carrier rule is at ' + stage + '. ' + rung.effect
    : 'LIVE: the carrier rule is at ' + stage + '. Is a carrier required? ' + String(rung.carrierRequired).replace(/^./, (c) => c.toUpperCase()) + '. ' + rung.effect + (last ? '' : ' The owner\'s full rule (every shipment hauled) is still PLANNED.');
  return { phase, known: true, optional, sentence, rung, today: sentence.replace(/^(PLANNED|LIVE): /, '').replace(/^./, (c) => c.toUpperCase()),
    /* The Marketplace is a different code path from a business-to-business
       haul at every rung (shipping.js: a channel sale settles instantly). */
    market: 'A Marketplace sale lands instantly with no haul.',
    short: optional ? 'a carrier is optional today' : 'the carrier rule is at ' + stage,
    risk: optional ? 'Today a carrier is a bonus. The owner\'s goal is for every business-to-business shipment to need one; with few carriers online that could leave goods waiting.'
      : 'The carrier rule is already at ' + stage + ': ' + rung.effect + ' The owner\'s goal is the full rule, and with few carriers online goods can be left waiting.' };
}

/* ── FACTS — everything the plan reasons over, gathered once ─────────────── */
function gather(id, o) {
  const data = o.data || {};
  const b = bizRow(data, id);
  const rec = recipeOf(data, id);
  const note = own(NOTES, id) || {};
  const labelOf = (x) => {
    const f = o.opLabel; const viaBridge = typeof f === 'function' ? safe(() => f(x), '') : '';
    if (viaBridge && viaBridge !== x) return viaBridge;
    const r = bizRow(data, x) || sysRow(data, x);
    return (r && r.label) || x;
  };
  const row = b && b.status !== 'planned' ? rowOf(o.opEcon, id, id) : (!b && !note.planned ? rowOf(o.opEcon, id, id) : null);
  const makes = rec && Array.isArray(rec.makes) ? rec.makes.filter((m) => m && realRes(data, m.id)) : [];
  const stashMakes = makes.filter((m) => m.live && m.via !== 'cityFirm').map((m) => m.id);
  const cityMakes = makes.filter((m) => m.live && m.via === 'cityFirm').map((m) => m.id);
  const wantMakes = makes.filter((m) => !m.live).map((m) => m.id);
  /* What the OPERATION yields on collect is the row's word, not recipes.js's. */
  const yieldIds = row && isObj(row.yields) ? Object.keys(row.yields) : makes.filter((m) => m.via === 'opsYield').map((m) => m.id);
  const phantomYields = hasCatalog(data) ? yieldIds.filter((y) => !catRow(data, y)) : [];
  const inputIds = row && isObj(row.inputs) ? Object.keys(row.inputs).filter((k) => realRes(data, k))
    : (row ? [] : uniq([].concat(
      rec && Array.isArray(rec.upkeep) ? rec.upkeep.filter((u) => u.via === 'opsInput').map((u) => u.id) : [],
      rec && Array.isArray(rec.buys) ? [].concat(...rec.buys.filter((l) => l.liveVia === 'opsInput').map((l) => l.liveIds || [])) : [])));
  const screenIds = uniq([].concat(
    rec && Array.isArray(rec.upkeep) ? rec.upkeep.filter((u) => u.via === 'minigame').map((u) => u.id) : [],
    rec && Array.isArray(rec.buys) ? [].concat(...rec.buys.filter((l) => l.liveVia === 'minigame').map((l) => l.liveIds || [])) : [],
  )).filter((x) => inputIds.indexOf(x) < 0 && realRes(data, x));
  /* ROUND 3. recipes.upkeep is not the whole truth about a sub-screen:
     coverage.js holds every LIVE craft / upkeep edge with its cite, and reading
     only recipes lost 76 of 106 of them — including the owner's one verbatim
     example, the cloth the Hospital really turns into bandages today. What the
     tile itself puts in a stash is not a need (a farm's own eggs, a boat's own
     fish), and 'build' rows are one-off facility costs, not running stock. */
  const screenWhy = {};
  const ownMakes = new Set(makes.filter((m) => m.live && m.via !== 'cityFirm').map((m) => m.id).concat(yieldIds));
  const covNeeds = fn(data.coverage, 'needsOf') ? (safe(() => data.coverage.needsOf(id), []) || []) : [];
  for (const n of covNeeds) {
    if (!n || n.live !== true || (n.role !== 'craft' && n.role !== 'upkeep')) continue;
    if (inputIds.indexOf(n.id) >= 0 || ownMakes.has(n.id) || !realRes(data, n.id)) continue;
    if (!screenWhy[n.id]) screenWhy[n.id] = { role: n.role, purpose: purposeOf(n.why) };
    if (screenIds.indexOf(n.id) < 0) screenIds.push(n.id);
  }

  const needs = b && Array.isArray(b.needs) ? b.needs : [];
  const suppliers = needs.filter((n) => n.direction !== 'buyer').map((n) => {
    const lane = laneBetween(data, id, n.biz); const peer = bizRow(data, n.biz);
    return { id: n.biz, label: labelOf(n.biz), confidence: n.confidence, ambiguous: n.direction === 'ambiguous',
      cargo: lane ? (lane.ids || []).filter((x) => realRes(data, x)) : [], liveCargo: lane ? (lane.liveIds || []) : [],
      why: lane ? lane.why : null, live: !!(lane && lane.live), exists: !peer || peer.status !== 'planned',
      sourceToday: lane ? (lane.sourceToday || []) : [], liveVia: lane ? (lane.liveVia || null) : null, cargoIsItem: !!(lane && lane.cargoIsItem), owned: ownsOf(o.owns, n.biz) };
  });
  /* Customers: tiles that drew THIS tile as a supplier, plus this tile's own
     buyer-direction icons (the Car Factory's Car Dealer). */
  const customers = [];
  for (const other of bizRows(data)) {
    if (!other || other.id === id || !Array.isArray(other.needs)) continue;
    for (const n of other.needs) {
      if (n.biz !== id || n.direction === 'buyer') continue;
      const lane = laneBetween(data, other.id, id);
      customers.push({ id: other.id, label: labelOf(other.id), cargo: lane ? (lane.ids || []).filter((x) => realRes(data, x)) : [], liveCargo: lane ? (lane.liveIds || []) : [],
        live: !!(lane && lane.live), exists: other.status !== 'planned', why: lane ? lane.why : null, ambiguous: n.direction === 'ambiguous' });
    }
  }
  for (const n of needs) {
    if (n.direction !== 'buyer') continue;
    const lane = laneBetween(data, id, n.biz);
    customers.push({ id: n.biz, label: labelOf(n.biz), cargo: lane ? (lane.ids || []).filter((x) => realRes(data, x)) : [], liveCargo: [], live: !!(lane && lane.live), exists: true, why: lane ? lane.why : null, ambiguous: false });
  }
  customers.sort((a, c) => (Number(c.live) - Number(a.live)) || (c.cargo.length - a.cargo.length));

  const sellsTo = rec && Array.isArray(rec.sellsTo) ? rec.sellsTo : [];
  const icons = (b && b.icons) || {};
  const kindOf = fn(data.shipping, 'tileKind');
  const cargoTile = b ? (kindOf ? safe(() => kindOf(id, data), null) === 'cargo' : (b.kind === 'producer' || b.kind === 'hub')) : false;
  const truck = fn(data.shipping, 'pdfTruckDrawn') ? safe(() => data.shipping.pdfTruckDrawn(id, data.businesses, data), null) : null;

  const lootable = fn(data.loot, 'lootableWith') ? safe(() => data.loot.lootableWith(data.catalog), null) : null;
  const lootNeeds = fn(data.coverage, 'lootNeedsOf') ? (safe(() => data.coverage.lootNeedsOf(id, lootable || undefined), []) || []) : [];
  const themed = fn(data.loot, 'themedIds') ? new Set(safe(() => data.loot.themedIds(), []) || []) : new Set();

  /* ROUND 4. Salvage was listed as the business that "wants Metal most" from a
     Car Dealer — Salvage yields Metal itself. A customer whose own stash already
     gets everything this tile could sell it is not a buyer for that cargo. */
  const makesItself = (c) => { const sell = c.cargo.filter((x) => stashMakes.indexOf(x) >= 0); return sell.length > 0 && sell.every((x) => stashProducers(data, x).indexOf(c.id) >= 0); };
  const buyers = customers.filter((c) => !makesItself(c));
  /* What the tile is ABOUT is not always its hourly yield (NOTES.income): a
     vehicle floor, a car line. The yield is then a byproduct. */
  const income = isObj(note.income) ? note.income : null;
  const liveSuppliers = suppliers.filter((s) => s.live && s.exists);
  const rule = transportRule(o);

  return { id, o, data, b, rec, note, row, labelOf, label: labelOf(id), makes, buyers, income, liveSuppliers, rule, stashMakes, cityMakes, wantMakes, yieldIds, phantomYields,
    inputIds, screenIds, screenWhy, covNeeds, ownMakes, suppliers, customers, sellsTo, icons, cargoTile, truck, lootNeeds, themed,
    /* Nothing to haul today: no product reaches a stash AND the owner drew no
       truck (Dojo, Card Shop). The goal still routes it through Transport, so
       the plan says so — but it does not tell a Dojo owner to go and hire a
       lorry for goods that do not exist. */
    nothingToShip: !stashMakes.length,
    planned: !!(b && b.status === 'planned') || (!b && !!note.planned), kind: b ? b.kind : null };
}

/* ── EARN — arithmetic over the row, nothing else ─────────────────────────── */
function blankEarn(id, text) {
  return { basis: PLAN_BASIS, known: false, workers: null, startup: null, grossPerHr: null, salaryPerHr: null, netPerHr: null, paybackHrs: null,
    perWorker: { grossPerHr: null, salaryPerHr: null, netPerHr: null }, margin: null, marginBand: UNKNOWN,
    startSmall: null, losing: false, shortfallPerHr: null, burnsPerHr: [], yieldsPerHr: [], capacity: null, paybackRank: null, text: text || 'Unknown.', caveats: [], source: id ? 'opEcon(\'' + id + '\')' : null };
}
function earnOf(F) {
  const r = F.row;
  const out = blankEarn(F.id);
  if (!r) {
    out.text = F.planned
      ? 'Unknown — this business is not in the game yet, so it has no rate, no payroll and no licence price. Those are the owner\'s to set; nothing here is a guess.'
      : 'Unknown — the game\'s figures for this business were not available when this plan was built. Open Just Business for the live rate; nothing here is a guess.';
    return out;
  }
  const w = pos(r.maxWorkers), rate = fin(r.ratePerWorkerHr), sal = fin(r.salaryPerWorkerHr), startup = fin(r.startup);
  out.startup = startup;
  out.perWorker = { grossPerHr: rate, salaryPerHr: sal, netPerHr: rate !== null && sal !== null ? Math.max(0, rate - sal) : null };
  if (w === null || rate === null || sal === null) {
    out.text = 'Unknown — the game\'s row for this business is missing its crew size, rate or payroll.';
    return out;
  }
  out.known = true; out.workers = w;
  out.grossPerHr = w * rate; out.salaryPerHr = w * sal; out.netPerHr = Math.max(0, out.grossPerHr - out.salaryPerHr);
  /* The game clamps a collect at zero (_opComputed: net = max(0, ...)), so a
     business whose payroll outruns its take never BILLS its owner — but a bare
     "keeps 0" hides that it is under water. The shortfall rides beside the
     clamp and the text says it. */
  out.shortfallPerHr = out.salaryPerHr > out.grossPerHr ? out.salaryPerHr - out.grossPerHr : 0;
  out.losing = out.shortfallPerHr > 0;
  out.paybackHrs = startup !== null && out.netPerHr > 0 ? startup / out.netPerHr : null;
  out.margin = rate > 0 ? Math.max(0, rate - sal) / rate : null;
  out.marginBand = out.margin === null || !MARGIN ? UNKNOWN : out.margin < MARGIN.thin ? 'thin' : out.margin >= MARGIN.healthy ? 'healthy' : 'fair';
  const ws = STAFFING ? Math.max(1, Math.min(w, Math.ceil(w * STAFFING.small))) : null;
  out.startSmall = ws === null ? null : { workers: ws, grossPerHr: ws * rate, salaryPerHr: ws * sal, netPerHr: Math.max(0, ws * (rate - sal)) };
  const per = (tbl) => (isObj(tbl) ? Object.keys(tbl).filter((k) => fin(tbl[k]) !== null && realRes(F.data, k)).map((k) => ({ id: k, name: resName(F.data, k), perHr: w * tbl[k] })) : []);
  out.burnsPerHr = per(r.inputs); out.yieldsPerHr = per(r.yields);
  /* An operation that burns what it yields (the Car Dealer: Metal in, Metal
     out) does not hand over its gross. Round 3 said "makes 18 Metal" and, a
     sentence later, "burns 12 Metal"; the player was left to subtract. */
  for (const y of out.yieldsPerHr) { const b = out.burnsPerHr.find((x) => x.id === y.id); y.burnedPerHr = b ? b.perHr : 0; y.netPerHr = y.perHr - y.burnedPerHr; }
  /* A warehouse's product is space; the row carries it, so it is derived too. */
  if (fin(r.storageBase) !== null || fin(r.storagePerWorker) !== null) out.capacity = (fin(r.storageBase) || 0) + (fin(r.storagePerWorker) || 0) * w;

  /* Where this payback sits among every business the caller can price. A rank
     is relative, so it cannot go stale on a retune the way "slow = over N
     hours" would. Needs the whole table (function or map), else stays null. */
  if (out.paybackHrs !== null) {
    const all = [];
    for (const x of bizRows(F.data)) {
      if (!x || x.status === 'planned') continue;
      const rr = x.id === F.id ? r : rowOf(F.o.opEcon, x.id, F.id); if (!rr) continue;
      const ww = pos(rr.maxWorkers);
      const n = ww !== null && fin(rr.ratePerWorkerHr) !== null && fin(rr.salaryPerWorkerHr) !== null ? ww * (rr.ratePerWorkerHr - rr.salaryPerWorkerHr) : null;
      if (n !== null && n > 0 && fin(rr.startup) !== null) all.push({ id: x.id, hrs: rr.startup / n });
    }
    if (all.length > 2) {
      all.sort((a, c) => a.hrs - c.hrs);
      const place = all.findIndex((x) => x.id === F.id) + 1;
      if (place > 0) out.paybackRank = { place, of: all.length, third: place <= all.length / 3 ? 'fastest' : place > (2 * all.length) / 3 ? 'slowest' : 'middle' };
    }
  }

  const bits = [];
  bits.push('With all ' + fmt(w) + ' workers on and a neutral market it brings in ' + fmt(out.grossPerHr) + ' Cinder an hour' + (out.losing
    ? ' against a payroll of ' + fmt(out.salaryPerHr) + ' — ' + fmt(out.shortfallPerHr) + ' an hour under water. The game never bills you that difference, but it never pays you anything either: at these figures the business earns nothing.'
    : ', pays ' + fmt(out.salaryPerHr) + ' in wages and keeps ' + fmt(out.netPerHr) + '.'));
  if (out.paybackHrs !== null) bits.push('At that pace the ' + fmt(startup) + ' Cinder licence pays for itself in ' + hoursWords(out.paybackHrs) + (out.paybackRank ? ' — number ' + out.paybackRank.place + ' of ' + out.paybackRank.of + ' businesses for speed of payback' : '') + '.');
  else if (out.losing) bits.push('So on its own it never pays the licence back.');
  else if (out.netPerHr <= 0) bits.push('At the game\'s current rate and payroll the wages eat the whole take, so on its own it never pays the licence back.');
  if (out.startSmall && out.startSmall.workers < w && !out.losing) bits.push('Starting small with ' + fmt(ws) + ' ' + (ws === 1 ? 'worker' : 'workers') + ' it keeps ' + fmt(out.startSmall.netPerHr) + ' an hour.');
  if (out.yieldsPerHr.length) bits.push('A full crew also makes ' + list(out.yieldsPerHr.map((y) => fmt(y.perHr) + ' ' + y.name)) + ' an hour.');
  if (out.burnsPerHr.length) bits.push('It burns ' + list(out.burnsPerHr.map((y) => fmt(y.perHr) + ' ' + y.name)) + ' an hour to do it.');
  const selfFed = out.yieldsPerHr.filter((y) => y.burnedPerHr > 0);
  if (selfFed.length) bits.push('So what it really hands you is ' + list(selfFed.map((y) => (y.netPerHr > 0 ? fmt(y.netPerHr) + ' ' + y.name + ' an hour' : 'no spare ' + y.name + ' at all'))) + ', after its own burn.');
  if (out.capacity !== null) bits.push('A full crew gives you ' + fmt(out.capacity) + ' units of storage to rent out.');
  out.text = bits.join(' ');
  out.caveats = [
    'These are the game\'s own figures ' + PLAN_BASIS + '. A real collect is multiplied by the Crash Exchange market for that business, your standing and your site, all of which move.',
    out.burnsPerHr.length ? 'Short of ' + list(out.burnsPerHr.map((y) => y.name), 'or') + ' the business does not stop — it runs at a fraction of its output. Wages are never reduced to match.' : 'It burns no resources today, so nothing throttles it but the market.',
    'Income builds up while you are away and is collected on the game\'s collection timer; it stops building once the timer\'s cap is reached.',
  ];
  return out;
}

/* ── needToStart ──────────────────────────────────────────────────────────── */
function cinderNeed(F, o) {
  const r = F.row; const amount = r ? fin(r.startup) : null;
  const gems = typeof o.gems === 'function' ? fin(safe(() => o.gems(), null)) : fin(o.gems);
  let afford = UNKNOWN;
  if (AFFORD && amount !== null && gems !== null) afford = amount <= 0 || gems / amount >= AFFORD.ready ? 'ready' : gems / amount >= AFFORD.close ? 'close' : 'far';
  let text;
  if (F.planned) text = 'Not set — this business is not in the game yet and its price is the owner\'s to set.';
  else if (amount === null) text = 'Unknown — the licence price was not available. Just Business shows the live price.';
  else {
    text = fmt(amount) + ' Cinder for the licence, paid from your own Cinder or, if you founded a corp, from its Treasury.';
    if (gems !== null) text += afford === 'ready' ? ' You hold ' + fmt(gems) + ' — enough.' : ' You hold ' + fmt(gems) + ' — ' + fmt(amount - gems) + ' short' + (afford === 'close' ? ', over half way.' : '.');
  }
  return { amount, known: amount !== null, held: gems, afford, text, live: !F.planned, source: 'opEcon(\'' + F.id + '\').startup' };
}
function azaNeed(F) {
  const amount = F.row ? pos(F.row.azaStartup) : null;
  if (amount === null) return { amount: null, known: !!F.row, text: F.row ? 'No Aza price — this one is bought with Cinder.' : (F.planned ? 'Not set.' : 'Unknown.'), live: !F.planned };
  return { amount, known: true, text: 'Or ' + fmt(amount) + ' Aza instead of the Cinder price.', live: true, source: 'opEcon(\'' + F.id + '\').azaStartup' };
}
function resourceNeeds(F, o, earn) {
  const out = []; const seen = new Set();
  const push = (id, extra) => {
    if (seen.has(id) || !realRes(F.data, id)) return; seen.add(id);
    const w = whereToFind(F.data, id, F.id, F.labelOf);
    /* One line for a list of six: the place, and who sells it. The full text
       stays on whereToFind for the row a player opens. */
    /* ROUND 4: the short form contradicted the sentence beside it — "this is
       what an Agricultural Op. ships you" followed by "nobody sells it yet".
       Both were half true: the map HAS a supplier, the game does not have it
       making this yet. So the short form names the planned supplier and says
       what today really is. */
    const plannedBy = uniq([].concat(w.wouldBeMadeBy || [], (extra && extra.plannedFrom) || []));
    const whereShort = (w.label || 'Not a battle drop') + (w.madeBy.length ? ' — or buy from ' + list(w.madeBy.slice(0, 2).map((b) => aan(F.labelOf(b)) + ' owner'), 'or')
      : plannedBy.length ? ' — today loot only' + (w.aimable === false && w.label ? ', and a lucky pull at that' : '') + '; planned supplier: ' + list(plannedBy.slice(0, 2).map(F.labelOf), 'or')
        : w.label ? ' — loot only' + (w.aimable === false ? ', a lucky pull' : '') + ': no business on the map makes it' : '') + '.';
    out.push(Object.assign({ id, name: resName(F.data, id), icon: resIcon(F.data, id), whereToFind: w.text, whereShort, _how: w.how, _label: w.label, _tail: w.tail, _lead: w.lead || '', wouldBeMadeBy: w.wouldBeMadeBy, noMaker: w.noMaker, whereSource: w.source, whereSystem: w.system, lootable: w.lootable, aimable: w.aimable, madeBy: w.madeBy, held: heldOf(o.held, id) }, extra));
  };
  for (const id of F.inputIds) {
    const burn = earn.burnsPerHr.find((x) => x.id === id);
    push(id, { live: true, when: 'always', perHrFullCrew: burn ? burn.perHr : null,
      why: 'The operation burns ' + resName(F.data, id) + ' every hour it runs' + (burn ? ' (' + fmt(burn.perHr) + ' an hour at full crew)' : '') + '. Run short and output falls with it, while wages do not.' });
  }
  let screenSaid = false;
  /* Which screen rows earn a place: what rides a lane the owner DREW first
     (the Hospital's cloth from the Fashion Brand, its shards from Research),
     then what recipes.js wrote a note for, then what a player can go and aim
     for. The rest are named in one line (screenMore), never dropped silently. */
  const laneOf = (rid) => F.suppliers.find((sp) => sp.cargo.indexOf(rid) >= 0) || null;
  const upk = (rid) => (F.rec && Array.isArray(F.rec.upkeep) ? F.rec.upkeep.find((x) => x.id === rid) : null);
  const screenRank = (rid) => (laneOf(rid) ? 0 : upk(rid) ? 1 : (F.themed.has(rid) || stashProducers(F.data, rid).some((m) => m !== F.id)) ? 2 : 3);
  const screenSorted = F.screenIds.slice().sort((a, c) => screenRank(a) - screenRank(c));
  const screen = screenName(F);
  for (const id of screenSorted.slice(0, MAX_SCREEN_NEEDS)) {
    const u = upk(id); const sw = F.screenWhy[id]; const sp = laneOf(id);
    /* The owner's example said out loud on the row it is about: who the map
       has shipping this, and who really does today. */
    /* "Ships you" is only true if that business really puts it in a stash. */
    const spMakes = sp ? stashProducers(F.data, id).indexOf(sp.id) >= 0 : false;
    const laneWords = sp ? (sp.exists ? (spMakes ? ' On the owner\'s map this is what ' + aan(sp.label) + ' ships you through Transport.'
      : ' On the owner\'s map ' + aan(sp.label) + ' would ship you this through Transport, but it does not make ' + resName(F.data, id) + ' today, so for now it comes from loot.')
      : ' On the owner\'s map ' + aan(sp.label) + ' would make this and ship it to you through Transport; it is not in the game yet' + (sp.sourceToday.length ? ', so today it comes from ' + list(sp.sourceToday.map((x) => aan(F.labelOf(x)))) + ' or from loot.' : ', so today it comes from loot.')) : '';
    push(id, { live: true, when: 'screen', screen, perHrFullCrew: null, role: sw ? sw.role : 'craft', laneFrom: sp ? sp.id : null, plannedFrom: sp && sp.exists && !spMakes ? [sp.id] : [],
      /* Said in full once; the Hospital has six of these. */
      why: (screenSaid ? 'Also only on ' + (screen || 'its own') + ' screen' : 'Used only when you work the business\'s own screen' + (screen ? ' (' + screen + ')' : '') + ', not by the hourly operation')
        + (sw && sw.purpose ? ' — it goes into ' + sw.purpose + '.' : '.') + (u && u.note ? ' ' + u.note : '') + laneWords });
    screenSaid = true;
  }
  const moreIds = screenSorted.slice(MAX_SCREEN_NEEDS).filter((x) => realRes(F.data, x));
  const screenMore = moreIds.length ? { screen, ids: moreIds, text: (screen || 'Its own screen') + ' also uses ' + list(moreIds.map((x) => resName(F.data, x))) + ' — the screen lists each recipe; none of it is needed by the hourly operation.' } : null;
  /* PLANNED loot needs: the owner's "every business needs battle loot". Inputs
     first, then things a player can AIM for (a themed source) before lottery
     drops — a plan that says "go and get X" must point somewhere. */
  /* ROUND 3 — REACHABLE FIRST. Round 2 ranked a planned tile by role alone and
     the Fashion Brand came out as five lucky pulls nobody makes, with Home
     Feed's wool, hide and leather and the Church ruins' silver sitting unshown
     further down the same list. A plan that says "go and get X" has to point
     somewhere, so the tiers are:
       0  a player can AIM for it in loot, or a business puts it in a stash today
       1  only a camp trader sells it (a shelf loot.js says can stand empty)
       2  only a planned / city-only maker is on the map
       3  a lucky pull that nothing on the map makes
     and role only orders rows inside a tier. The pool is every non-live need,
     not just the hand-lootable ones: a need a neighbour MAKES is as reachable
     as one that drops. 'trade' rows are what the tile sells, not what it needs. */
  const pool = []; const poolSeen = new Set();
  for (const n of [].concat(F.lootNeeds, F.covNeeds)) {
    if (!n || n.live || n.role === 'trade' || n.role === 'sim' || seen.has(n.id) || poolSeen.has(n.id)) continue;
    if (F.ownMakes.has(n.id) || F.wantMakes.indexOf(n.id) >= 0 || !realRes(F.data, n.id)) continue;
    poolSeen.add(n.id);
    const w = whereToFind(F.data, n.id, F.id, F.labelOf);
    const tier = (w.aimable && w.lootable) || w.madeBy.length ? 0 : w.aimable ? 1 : w.wouldBeMadeBy.length ? 2 : 3;
    pool.push({ n, tier, aim: !!w.aimable, src: w.madeBy.length ? 'biz:' + w.madeBy[0] : 'loot:' + (w.source || '') });
  }
  const role = (n) => (n.role === 'input' ? 0 : n.role === 'upkeep' ? 1 : n.role === 'craft' ? 2 : 3);
  pool.sort((a, c) => (a.tier - c.tier) || (role(a.n) - role(c.n)) || (Number(c.aim) - Number(a.aim)));
  /* One supplier must not fill the whole card (three Home Feed rows say it;
     five hide the Church ruins). Skipped rows come back only if the card would
     otherwise fall through to a worse tier — so a dead end is never shown while
     a reachable need is not. */
  const picked = []; const perSrc = {}; const skipped = [];
  for (const x of pool) {
    if (x.tier === 0 && (perSrc[x.src] || 0) >= MAX_PER_SOURCE) { skipped.push(x); continue; }
    perSrc[x.src] = (perSrc[x.src] || 0) + 1; picked.push(x);
  }
  const firstWorse = picked.findIndex((x) => x.tier > 0);
  const shown = (firstWorse < 0 ? picked.concat(skipped) : picked.slice(0, firstWorse).concat(skipped, picked.slice(firstWorse))).slice(0, MAX_PLANNED_NEEDS);
  /* "Every business needs battle loot" is the owner's sentence: if the map has
     an aimable drop for this tile and the cut above holds none, the last row
     gives way to it. */
  const drops = (x) => x.aim && x.tier === 0;
  const bestAim = pool.find(drops);
  if (bestAim && shown.length && !shown.some(drops)) shown[shown.length - 1] = bestAim;
  for (const x of shown) push(x.n.id, { live: false, when: 'planned', perHrFullCrew: null, role: x.n.role, tier: x.tier, why: plainWhy(x.n.why) });
  /* `live: false` and the view's PLANNED tag already say nothing is charged
     today; round 1 also said it in words on every row. */
  /* The makers of what is shown, for derivedSuppliers(): a need that a business
     makes is a reason to know that business, drawn beside the tile or not. */
  /* Only for needs the DRAWN suppliers do not already cover: a Weapon Smith
     with a Mining Company drawn beside it does not need telling that a Car
     Dealer also turns out metal. */
  const makerRows = {};
  const drawnCovers = (r) => F.suppliers.some((sp) => sp.exists && (sp.cargo.indexOf(r.id) >= 0 || (r.madeBy || []).indexOf(sp.id) >= 0));
  for (const r of out) { if (drawnCovers(r)) continue; for (const m of (r.madeBy || [])) { if (m === F.id || !bizRow(F.data, m)) continue; (makerRows[m] || (makerRows[m] = [])).push(r); } }
  F.orphanStock = out.filter((r) => r.live && r.when === 'screen' && r.aimable === false && !(r.madeBy || []).length && !(r.wouldBeMadeBy || []).length && !(r.plannedFrom || []).length).map((r) => r.id)
    .concat(moreIds.filter((x) => !stashProducers(F.data, x).some((m) => m !== F.id) && !plannedProducers(F.data, x).some((m) => m !== F.id) && !laneOf(x) && whereToFind(F.data, x, F.id, F.labelOf).aimable === false));
  F.deadEnds = out.filter((r) => !r.live && r.tier === 3).map((r) => r.id);
  for (const r of out) if (!r.live && r.tier === 3) r.deadEnd = true;
  return { rows: out, notes: foldRepeats(out), screenMore, makerRows };
}
/* coverage.js writes its reasons for the audit. A player gets the sentence with
   the provenance brackets and internal names taken out, or a plain fallback. */
function plainWhy(t) {
  let x = String(t || '');
  for (let i = 0; i < 3; i += 1) x = x.replace(/\s*\([^()]*\)/g, '');
  x = x.replace(/\s+/g, ' ').trim();
  if (!x || JARGON.test(x)) return 'On the owner\'s plan this business would use it.';
  return /[.!?]$/.test(x) ? x : x + '.';
}
/* Suppliers the owner did not draw but the needs list implies: whoever MAKES a
   shown need. Home Feed beside the Fashion Brand is the case that started it —
   round 2 showed the brand with zero suppliers under a headline about wool. */
function derivedSuppliers(F, rn) {
  const have = new Set(F.suppliers.map((s) => s.id));
  return Object.keys(rn.makerRows || {}).filter((m) => !have.has(m) && m !== 'transport')
    .map((m) => ({ id: m, rows: rn.makerRows[m] })).sort((a, c) => c.rows.length - a.rows.length).slice(0, MAX_DERIVED_SUPPLIERS)
    .map((x) => {
      const peer = bizRow(F.data, x.id); const live = x.rows.some((r) => r.live);
      const cargo = x.rows.map((r) => r.id);
      return { id: x.id, label: F.labelOf(x.id), confidence: 'derived', ambiguous: false, drawn: false, cargo, liveCargo: x.rows.filter((r) => r.live).map((r) => r.id),
        /* Live and planned never share a clause: what is used today is said
           first and the owner's plan second. */
        why: aan(F.labelOf(x.id)).replace(/^a/, 'A') + ' makes the ' + (F.planned ? names(F, cargo, 4) + ' this business would run on'
          : [live ? names(F, x.rows.filter((r) => r.live).map((r) => r.id), 4) + ' this business uses today' : '', x.rows.some((r) => !r.live) ? names(F, x.rows.filter((r) => !r.live).map((r) => r.id), 4) + ' the owner\'s plan has it using' : ''].filter(Boolean).join(', and the ')) + '.',
        /* `why` has just said what is used today; the status is one word. */
        liveWords: live ? ' LIVE.' : null,
        live, exists: !peer || peer.status !== 'planned', sourceToday: [], liveVia: live ? (x.rows.some((r) => r.live && r.when === 'always') ? 'opsInput' : 'minigame') : null, cargoIsItem: false, owned: ownsOf(F.o.owns, x.id) };
    });
}
function businessNeeds(F) {
  const out = F.suppliers.concat(F.derived || []).map((s) => ({
    id: s.id, label: s.label, role: 'supplier', live: s.live, exists: s.exists, owned: s.owned, ambiguous: s.ambiguous, cargo: s.cargo,
    how: s.owned ? 'you already own one' : 'own one or find an owner to buy from',
    drawn: s.drawn !== false,
    why: (s.why || 'Drawn beside this business on the owner\'s map.') + (s.drawn === false ? ' The owner drew no icon between you; it is listed because of what it makes.' : '')
      + (s.liveWords ? s.liveWords : s.live ? ' LIVE: ' + list(s.liveCargo.map((x) => resName(F.data, x))) + (s.liveVia === 'minigame' ? ' is really used today, on ' + (doorShort(F) || 'the business\'s own') + ' screen.' : ' is really burned today.') : ' PLANNED: the game does not make you buy this yet.')
      + (!s.exists ? ' ' + s.label + ' is not in the game yet' + (s.sourceToday.length ? '; today the same goods come from ' + list(s.sourceToday.map(F.labelOf)) + '.' : '.') : '')
      + (s.ambiguous ? ' The map is unclear whether this is your supplier or your buyer.' : ''),
  }));
  if (F.cargoTile && F.id !== 'transport') {
    const pharma = F.id === 'medical';
    out.push({ id: 'transport', label: F.labelOf('transport'), role: 'carrier', live: pharma || (F.rule.known && !F.rule.optional), phase: F.rule.phase, exists: true, owned: ownsOf(F.o.owns, 'transport'), ambiguous: false, cargo: [],
      how: 'hire one, or own one',
      why: (pharma ? 'LIVE for Hospital pharma wholesale and plague-cure waybills: the sale is refused without a player-owned carrier. For everything else: '
        : 'Every shipment to another player\'s business goes through a Transport company on the owner\'s map. ')
        + F.rule.sentence + (F.rule.market ? ' ' + F.rule.market : '')
        + (F.truck && F.truck.basis === 'goal' ? ' No truck is drawn beside this tile on the PDF; it is listed because the written goal says every business ships through Transport.' : '')
        + (F.nothingToShip ? ' Today it makes nothing you can hold, so there is nothing to haul yet.' : '') });
  }
  return out;
}

/* ── partner + customer picks ─────────────────────────────────────────────── */
/* Both directions of a link, read straight off the recipe table. laneBetween()
   answers "is there a lane" and returns the first it finds, which is wrong for
   the pairs the owner drew BOTH ways (Medical <-> Research, Genetics <->
   Research): round 1 called Research "your supplier of ... Medicine". */
function lanesWith(data, selfId, otherId) {
  const pick = (buyer, seller) => { const r = recipeOf(data, buyer); return (r && Array.isArray(r.buys) ? r.buys.find((l) => l && l.from === seller) : null) || null; };
  return { inbound: pick(selfId, otherId), outbound: pick(otherId, selfId) };
}
/* partners.js writes its reasons for the partners panel: provenance in brackets
   for the audit and its own LIVE/PLANNED sentence at the end. A plan step
   states the status itself, ONCE, so only the plain claim in front of all that
   is borrowed — and nothing at all if an internal name survives the trim. */
/* \bD\d\b: the owner-decision codes are the lead's filing system, not
   something a player has ever seen. The last alternative catches any
   SHOUTING_SNAKE symbol name a sibling's cite might carry. */
export const JARGON = /OPS_ECON|player_banks|opsInput|opsYield|cityFirm|_[a-z]+\(|\.js\b|sql\/|\bD\d\b|[A-Z]{2,}_[A-Z_]+/;
function plainReason(t) {
  let x = String(t || '');
  const cut = x.search(/\s(LIVE|PLANNED)\b/); if (cut >= 0) x = x.slice(0, cut);
  for (let i = 0; i < 3; i += 1) x = x.replace(/\s*\([^()]*\)/g, '');
  x = x.replace(/\s+/g, ' ').trim();
  if (!x || JARGON.test(x)) return null;
  return /[.!?]$/.test(x) ? x : x + '.';
}
/* recipes.js cites its table names in brackets for the audit; a player reads
   the sentence without them. */
const serviceWords = (F) => (F.rec && F.rec.service ? String(F.rec.service).split(' (').map((part, i) => (i && JARGON.test('(' + part.split(')')[0]) ? part.split(')').slice(1).join(')') : (i ? ' (' : '') + part)).join('') : null);
function partnerFacts(F, id, role, row) {
  const L = lanesWith(F.data, F.id, id);
  const lane = role === 'supplier' ? L.inbound : L.outbound;
  const back = role === 'supplier' ? L.outbound : L.inbound;
  const real = (ids) => (ids || []).filter((x) => realRes(F.data, x));
  const cargo = real(lane ? lane.ids : (row && row.cargo) || []);
  /* Without a recipe lane (an undrawn pairing) "live" can only be about cargo
     this operation really burns, so that is all that is named as live. */
  const liveCargo = lane ? real(lane.liveIds) : (row && row.live && role === 'supplier' ? cargo.filter((x) => F.inputIds.indexOf(x) >= 0) : []);
  return { id, label: F.labelOf(id), role, cargo, liveCargo, liveVia: lane ? (lane.liveVia || null) : null,
    why: (lane && lane.why) || (row ? plainReason((row.reasons || [])[0]) : null),
    back: back ? { cargo: real(back.ids), live: !!back.live } : null,
    client: F.kind === 'service' && role === 'customer' ? (F.note.client || null) : null,
    owned: ownsOf(F.o.owns, id), exists: true };
}
function firstPartner(F) {
  /* partners.js is a same-wave sibling: used when the caller injects it (the
     shell does), never imported. Its ROW is the authority on live and drawn —
     the recipe lanes know nothing of the undrawn pairings it proposes, which is
     how round 1 printed "not a lane the owner drew ... it is the link the owner
     drew" in one paragraph. Carrier, channel, financier and storage rows are
     skipped: they have their own steps, or are not where a new owner starts. */
  const bp = fn(F.data.partners, 'bestPartners');
  if (bp) {
    const ranked = safe(() => bp(F.id, F.data), []) || [];
    const cand = Array.isArray(ranked) ? ranked.filter((p) => p && p.id !== F.id && p.id !== 'transport' && (p.role === 'supplier' || p.role === 'customer') && bizRow(F.data, p.id) && bizRow(F.data, p.id).status !== 'planned') : [];
    /* ROUND 5. partners.js ranks by how important the pairing is on the owner's
       MAP, which is the right ranking for "best partners" and the wrong one for
       "the first thing you do". It put Car Factory (drawn, but the hand-off is
       not in the game) ahead of Gas Station (a real input today) on eight
       tiles, so step 4 told a new owner to go and find someone they cannot yet
       trade with. The first partner is the best pairing that WORKS TODAY;
       partners.js's own order decides within each group, and the planned
       marquee link is still named — step 6 picks a different link and takes it.
       When nothing live is on offer the planned one is kept, said as planned. */
    /* ROUND 6 — the critic's biggest gap. "Best live pairing" alone let an
       UNDRAWN partner beat one the owner actually drew whenever both worked
       today, and the owner's instruction is "follow the map I made in the pdf".
       The order is now: live AND drawn, then live, then drawn, then whatever
       partners.js ranked first. Only the ORDERING is ours — which candidates
       exist, and their live / pdfDrawn flags, stay partners.js's answer — and
       the piece's check pins the result per tile, so a re-rank upstream turns a
       suite red instead of quietly rewriting the player's first instruction. */
    /* ROUND 7 — the critic's biggest gap. A partners.js ROW is one pairing with
       up to two directions, and its top-level `live` is only the LEAD line's.
       `anyLive` is the row's real answer to "is there a deal here that works
       today". Testing `live` alone made Construction the one tile of 25 whose
       drawn partner is live in just one direction (Trash Crusher BUYS your
       metal, live; it does not yet ship you any) lose to Oil Company — which
       had won on the identical kind of line — and then step 4 printed "the game
       does not make either of those deals yet" about a deal section 6 of the
       same modal prints as LIVE ON THE MAP. A pairing with any live direction is
       a live deal. Three more tiles move with it (oil, cars, carfactory) for the
       same reason, and all four are repinned in the piece's check. */
    const anyLive = (p) => p.live === true || p.anyLive === true;
    const hit = cand.find((p) => anyLive(p) && p.pdfDrawn === true)
      || cand.find(anyLive)
      || cand.find((p) => p.pdfDrawn === true) || cand[0] || null;
    if (hit) {
      /* When the live direction is not the lead's, the PLAYER-FACING role is the
         live one — otherwise partnerStatus would describe the dead direction as
         the thing that works today, which is the falsehood in reverse. */
      const goods = (hit.lines || []).filter((l) => l && l.live === true && (l.role === 'supplier' || l.role === 'customer'));
      /* A row can carry a live line in BOTH directions (Oil ↔ Car Factory: they
         sell you supplies, they buy your fuel). Keep the lead's direction when
         one of its own lines is live — partners.js chose that lead — and only
         cross over when the lead's direction has nothing live at all. */
      const liveLine = hit.live === true ? null : (goods.find((l) => l.role === hit.role) || goods[0] || null);
      const role = liveLine ? liveLine.role : hit.role;
      const out = Object.assign(partnerFacts(F, hit.id, role, hit), { live: anyLive(hit), drawn: hit.pdfDrawn === true, tier: fin(hit.tier), ambiguous: hit.ambiguous === true, from: 'partners.js' });
      if (liveLine) {
        out.why = plainReason(liveLine.text) || out.why;
        /* The recipe LANE for that direction may be entirely planned (Oil's
           drawn lane to Car Factory carries petrochemicals and rubber, none of
           it live) while the live line is about a different id the factory
           really burns. Without folding worksCargo in, the step listed the
           planned cargo and then claimed "they really use what you sell today"
           about something it had not named. */
        const add = (liveLine.worksCargo || []).filter((x) => realRes(F.data, x));
        out.cargo = uniq(out.cargo.concat(add)); out.liveCargo = uniq(out.liveCargo.concat(add));
      }
      /* When the first move is NOT a link on the map, the map's own link rides
         along so step 4 can name it in the same breath. Before this a
         Construction owner was sent to an Oil Company with no hint that the
         owner had drawn Trash Crusher and Mining beside that tile. */
      if (!out.drawn) {
        const alt = cand.filter((p) => p.pdfDrawn === true && p.id !== hit.id).slice(0, 2);
        if (alt.length) out.drawnAlt = alt.map((p) => ({ id: p.id, label: F.labelOf(p.id), live: anyLive(p), role: p.role }));
      }
      return out;
    }
  }
  const sup = F.suppliers.filter((s) => s.exists && !s.ambiguous).sort((a, c) => (Number(c.live) - Number(a.live)) || (c.cargo.length - a.cargo.length))[0];
  if (sup) return Object.assign(partnerFacts(F, sup.id, 'supplier', null), { live: sup.live, drawn: true, tier: null, ambiguous: false, from: 'map' });
  const cus = F.customers.filter((c) => c.exists)[0];
  if (cus) return Object.assign(partnerFacts(F, cus.id, 'customer', null), { live: cus.live, drawn: true, tier: null, ambiguous: cus.ambiguous, from: 'map' });
  return null;
}
/* Exactly ONE status sentence per partner, from the four combinations of
   live / planned and drawn / not drawn. Never two, never a generic tail. */
function partnerStatus(F, p) {
  const liveNames = names(F, p.liveCargo, 3);
  if (p.live) {
    let what;
    if (p.client) what = F.note.clientLive || 'this works between players today';
    else if (p.role === 'supplier') what = liveNames ? (p.liveVia === 'minigame' ? liveNames + ' is used today inside ' + (doorShort(F) || 'the business\'s own screen') + ', not by the hourly operation' : 'the operation really burns ' + liveNames + ' every hour today') : 'this is a real input today';
    else what = liveNames ? p.label + ' really uses ' + liveNames + ' today' : 'they really use what you sell today';
    const rest = !p.client && p.liveCargo.length && p.cargo.length > p.liveCargo.length ? ' The rest of that list is the owner\'s plan, not yet the game.' : '';
    return (p.drawn ? 'LIVE, and a link the owner drew: ' : 'LIVE, though the owner drew no icon between you: ') + what + '.' + rest;
  }
  return p.drawn ? 'PLANNED: the owner drew this link, but the game does not make either of you deal with the other yet.'
    : 'PLANNED, and the owner drew no icon between you either: it is a sensible pairing only if the owner switches the planned loot needs on.';
}
/* The door's name without its explanation: 'The Hospital', not the whole clause. */
const doorShort = (F) => (F.note.door ? F.note.door.split(/ — |,| \(|:/)[0] : null);
/* The ONE screen a stock row belongs to, short enough to say six times. A door
   can name two places ('the Foundry screen and "Post a Scrap Run" ...'); the
   stock is used in the first, unless NOTES says otherwise (a carrier's spare
   parts are spent at the Freight Depot, not on the Haulage Board). */
const screenName = (F) => F.note.screen || (doorShort(F) ? doorShort(F).split(' and ')[0].replace(/ screen$/, '') : null);
/* What a tile SELLS is only what reaches its stash today; the rest of a drawn
   lane is named as the owner's plan (Mining sells Metal, not yet Copper Ore). */
function sellWords(F, ids) {
  const have = (ids || []).filter((x) => F.stashMakes.indexOf(x) >= 0); const rest = (ids || []).filter((x) => have.indexOf(x) < 0);
  if (!have.length) return rest.length ? names(F, rest) + (F.planned ? '' : ' (on the owner\'s plan — not something you can hold today)') : '';
  return names(F, have) + (rest.length ? ' (and ' + names(F, rest, 2) + ' once that line is live)' : '');
}
const names = (F, ids, n) => list((ids || []).slice(0, n || 3).map((x) => resName(F.data, x)));
/* The businesses the MAP draws buying from this one, named. Used where a purely
   structural sentence would otherwise read the same on two tiles of the same
   shape; empty for a tile nobody is drawn buying from. */
const buyerWords = (F) => list((F.buyers || []).filter((c) => c.exists).slice(0, 2).map((c) => c.label));
/* ROUND 5. list() puts "and" before its last item, so every truncated list met
   a second one: "Meat and Eggs and 12 more", "Fuel, Naphtha and Kerosene and
   more", "Bread and Fruit and more". When a tail follows, the shown items are
   joined with commas only and the tail carries the single "and". */
const andMore = (shown, tail) => { const x = (shown || []).filter(Boolean); return tail ? x.join(', ') + (x.length ? ' and ' : '') + tail : list(x); };
/* Resource names with an "and N more" tail when the list is longer than n. */
const namesMore = (F, ids, n) => { const all = ids || []; const k = n || 3; return andMore(all.slice(0, k).map((x) => resName(F.data, x)), all.length > k ? (all.length - k) + ' more' : null); };
function productWords(F) {
  if (F.stashMakes.length) return namesMore(F, F.stashMakes, 4);
  if (F.rec && F.rec.service) return null;
  /* ROUND 4: on a LIVE tile a planned product is not what it makes. Round 3's
     Smuggling plan read "Makes: Contraband (planned)" and then told the player
     to go and sell it. */
  if (F.wantMakes.length && F.planned) return names(F, F.wantMakes, 3) + ' (planned)';
  return null;
}
/* Step 2 of a PLANNED tile, built from the map's own rows rather than from the
   owner's prose sentence (which the headline already carries). Returns null
   when the tile has nothing drawn either side, so the caller can fall back. */
function wouldDo(F) {
  const parts = [];
  const mk = F.wantMakes.length ? names(F, F.wantMakes, 4) : null;
  if (mk) parts.push('It would make ' + mk + '.');
  const cus = (F.customers || []).filter((c) => c.exists !== false);
  if (cus.length) parts.push('The owner drew ' + (cus.length > 1 ? 'its buyers' : 'its buyer') + ': ' + list(cus.map((c) => c.label + (c.cargo && c.cargo.length ? ' (' + names(F, c.cargo, 3) + ')' : ''))) + '.');
  else if (!F.cargoTile) parts.push('It would sell nothing to other players: like the Bus Company and the Rail Road its customer is the city itself, and the players who need to reach it.');
  else parts.push('The owner drew no buyer beside it, so who it would sell to is still open.');
  /* F.derived carries the suppliers worked out from the recipe graph (Home Feed
     for Fashion, Oil Company for the Airport); without it this step names a
     buyer and no source at all. */
  const sup = (F.suppliers || []).concat(F.derived || []).filter((s) => s.exists !== false);
  if (sup.length) parts.push('What it would buy in comes from ' + list(sup.map((s) => s.label + (s.cargo && s.cargo.length ? ' (' + names(F, s.cargo, 3) + ')' : ''))) + '.');
  if (!parts.length) return null;
  parts.push('None of that line runs today.');
  return parts.join(' ');
}
/* The "Makes:" line of the plan. What the business is ABOUT comes first; an
   hourly yield that is not the point is called a byproduct; a product that
   exists only on the owner's plan, or only inside a city, is said as that. */
function makesWords(F) {
  const stash = productWords(F);
  if (F.income) return F.income.sells + (F.stashMakes.length ? '; byproduct: ' + names(F, F.stashMakes, 3) + (F.income.byproduct ? ' (' + F.income.byproduct + ')' : '') : '');
  if (F.planned || F.stashMakes.length) return stash;
  if (F.rec && F.rec.service) return null;
  const later = F.wantMakes.length ? 'on the owner\'s plan it would deal in ' + names(F, F.wantMakes, 3) : '';
  return 'nothing you can hold today — its product is hourly Cinder' + (later ? ' (' + later + ')' : '');
}
function outlets(F) {
  const out = [];
  if (F.icons.market) out.push('the Marketplace (Ruin Exchange, Resource Exchange)');
  if (F.icons.carMarket) out.push('the Car Marketplace');
  if (F.icons.card || F.sellsTo.indexOf('sys:battle') >= 0) out.push('battlers');
  if (F.sellsTo.indexOf('sys:camp') >= 0) out.push('camp trainers');
  if (F.sellsTo.indexOf('sys:city') >= 0) out.push('City Builders');
  return out;
}

/* ── FIT — rules over facts; each reason names this tile's own things ─────── */
function fitOf(F, earn) {
  const fit = [], not = [];
  const add = (arr, style, why, weight) => arr.push({ style, label: STYLE[style].label, why, text: STYLE[style].label + ' — ' + why, weight: weight || 1 });
  const prod = productWords(F);
  /* What the HOURLY operation hands over. productWords() is the whole product
     list including what only a played screen makes (the farm's sixteen), and
     "turns your loot into" must not promise those for feeding it. */
  const opYields = F.yieldIds.filter((x) => realRes(F.data, x));
  const opProd = opYields.length ? names(F, opYields, 3) + ' and hourly Cinder' : null;
  const lootInputs = F.inputIds.filter((x) => F.themed.has(x));
  const sellsBattle = F.icons.card || F.sellsTo.indexOf('sys:battle') >= 0;
  const sellsCamp = F.sellsTo.indexOf('sys:camp') >= 0;
  const sellsCity = F.sellsTo.indexOf('sys:city') >= 0;
  const nSup = F.suppliers.length; const nLive = F.liveSuppliers.length;
  const topCustomer = F.buyers.filter((c) => c.exists)[0];
  const feedsTransport = (bizRow(F.data, 'transport') || { needs: [] }).needs.some((n) => n.biz === F.id);

  // battler
  /* The card icon is the owner's own word for "battlers want this"; the reason
     is authored per tile (NOTES.battler) because six tiles quoting the legend
     at the reader is the boilerplate the bar forbids. Loot-fed is a weaker,
     derived reason and only counts when the feedstock really drops in BATTLE
     (Fresh Fish is landed at camp, so the Cannery does not qualify). */
  const battleFed = lootInputs.filter((x) => { const w = whereToFind(F.data, x, F.id, F.labelOf); return w.system === 'sys:battle' && w.aimable; });
  const battleSrc = battleFed.length ? (whereToFind(F.data, battleFed[0], F.id, F.labelOf).label || '').replace(/^The /, 'the ') : '';
  const burnWords = battleFed.map((x) => { const b = earn.burnsPerHr.find((y) => y.id === x); return (b ? fmt(b.perHr) + ' ' : '') + resName(F.data, x); });
  if (!F.planned && F.icons.card === true) add(fit, 'battler', 'the owner put the battler card on it — ' + (F.note.battler || (F.note.door ? 'it opens ' + F.note.door : 'what it makes is for fighters')) + '.', 3);
  else if (!F.planned && F.icons.card === '?') add(fit, 'battler', 'a battler card sits beside it on the map (it may belong to the neighbouring tile) — ' + (F.note.battler || 'its output reaches fighters') + '.', 2);
  else if (battleFed.length && battleFed.length === F.inputIds.length && F.kind !== 'cityTransit') add(fit, 'battler', 'it turns your loot into ' + (opProd || 'hourly Cinder') + ': the ' + list(burnWords) + ' a full crew burns each hour ' + (battleSrc ? 'comes off ' + battleSrc + ', which you are clearing anyway.' : 'is what you bring home from fights anyway.'), 1);
  else if (!sellsBattle && !sellsCamp && F.kind !== 'cityTransit') /* ROUND 6. This line and the operator one below are derived from structure
     alone, so two tiles of the same shape (Mining and Salvage both sell Metal
     and open no screen) printed word-for-word the same reason not to buy them.
     Naming the buyers the MAP draws, and what does or does not arrive at the
     door, separates them with facts already in the graph — no new opinion, and
     nothing that can go stale. */
    add(not, 'battler', 'nothing it makes strengthens a deck' + (prod ? ' — ' + prod + ' goes to ' + (buyerWords(F) || (sellsCity ? 'builders and other businesses' : 'other businesses')) : '') + ', so it only makes sense as a side income.', F.inputIds.length ? 1 : 2);

  // trainer
  if (F.kind === 'producer' && sellsCamp && F.note.door && /camp/i.test(F.note.door)) add(fit, 'trainer', 'what it unlocks lives at your camp: ' + F.note.door + '.', 3);
  else if (sellsCamp && F.kind === 'producer' && F.stashMakes.length) add(fit, 'trainer', 'camps buy what it makes (' + names(F, F.stashMakes) + '), so you supply your own camp first and sell the rest.', 1);

  // trader
  if (F.icons.market && F.stashMakes.length > 1) add(fit, 'trader', 'the Marketplace icon is on it and it gives you ' + F.stashMakes.length + ' different things to list (' + andMore(F.stashMakes.slice(0, 3).map((x) => resName(F.data, x)), F.stashMakes.length > 3 ? 'more' : null) + ').', 2);
  else if (F.icons.market && F.icons.carMarket) add(fit, 'trader', 'the owner marked it for both the Marketplace and the Car Marketplace.', 2);
  else if (F.icons.market && (F.stashMakes.length || F.planned)) add(fit, 'trader', 'the Marketplace icon is on it' + (prod ? ': ' + prod + ' is yours to price' : '') + '.', 1);
  else if (F.icons.market && F.note.door) add(fit, 'trader', 'the Marketplace icon is on it, though today it makes nothing you can list — the selling happens in ' + doorShort(F) + '.', 1);
  else if (F.kind === 'producer' && !F.icons.market) add(not, 'trader', 'the owner drew no Marketplace icon beside it — it earns from ' + (list(outlets(F)) || 'its hourly rate') + ', not from listings.', 2);
  else if (F.kind === 'service' || F.kind === 'cityTransit') add(not, 'trader', 'it makes nothing you can list; the income is ' + (F.kind === 'service' ? 'a service you run' : 'a city utility') + '.', 1);

  // builder
  if (F.kind === 'cityTransit') add(fit, 'builder', 'it exists only for a city: ' + (F.note.door || 'city transit') + '.', 4);
  else if (F.id === 'construction' || (F.note.door && /city build/i.test(F.note.door))) add(fit, 'builder', F.note.door + '.', 4);
  else if (sellsCity && F.cityMakes.length) add(fit, 'builder', 'placed as a city tile it founds a firm making ' + names(F, F.cityMakes) + ' inside your city\'s economy.', 1);
  if (F.kind === 'cityTransit') add(not, 'battler', 'it does nothing outside a city — no loot in, nothing for a deck out.', 3);

  // hauler
  if (F.id === 'transport') add(fit, 'hauler', 'this IS the carrier: every lane on the owner\'s map runs through you.', 5);
  else if (feedsTransport) add(fit, 'hauler', 'every Transport company on the map needs one of these (' + (names(F, (F.customers.find((c) => c.id === 'transport') || { cargo: [] }).cargo) || 'its supplier') + '), so it pairs naturally with a haulage business.', 2);
  else if (!F.cargoTile && F.b) add(not, 'hauler', 'it ships nothing, so it gives a truck no work.', 1);

  // investor vs operator — unknowable for a business that does not exist yet
  /* ROUND 5. earn.losing (payroll outruns the take, so the game's collect
     clamps to zero) was already SAID in the earn text and in step 6, but the
     fit block never read it: a tile could be under water and still be sold to a
     passive investor as "found it, staff it, collect". The whole point of that
     style is a number that arrives on its own, so a row with no number to
     collect disqualifies it outright, ahead of every other investor line. */
  if (!F.planned) {
    if (earn.known && earn.losing) add(not, 'investor', 'there is nothing to collect: at the game\'s current figures its payroll outruns what a full crew brings in by ' + fmt(earn.shortfallPerHr) + ' Cinder an hour, so the hourly take is zero' + (F.note.plays && doorShort(F) ? ' — only ' + doorShort(F) + ' makes it worth owning.' : '.'), 5);
    else if (DEPENDENCY && !F.note.plays && nSup < DEPENDENCY.heavy && !F.inputIds.length) add(fit, 'investor', 'nothing to stock and nothing to play: found it, staff it, collect' + (earn.paybackRank && earn.paybackRank.third === 'fastest' ? ' — and it is among the fastest on the map to pay back (number ' + earn.paybackRank.place + ' of ' + earn.paybackRank.of + ')' : '') + '.', 3);
    else if (DEPENDENCY && !F.note.plays && nSup <= DEPENDENCY.light) add(fit, 'investor', 'only ' + names(F, F.inputIds) + ' to keep stocked, and otherwise it runs itself.', 2);
    /* ROUND 4. Smuggling's headline said "you depend on nobody but a fuel
       seller" and this line called it a four-supplier network business. Both
       read the same map: four suppliers are DRAWN, one is a real input. What
       is real decides fit; what is drawn is said as the owner's plan. */
    else if (DEPENDENCY && nSup >= DEPENDENCY.heavy && !F.note.plays && nLive <= DEPENDENCY.light) add(fit, 'investor', 'today it runs itself on ' + (names(F, F.inputIds) || 'nothing at all') + '. The map draws ' + nSup + ' suppliers beside it, but only ' + (list(F.liveSuppliers.map((s) => s.label)) || 'none of them') + ' is a real input yet — it turns into a network business only if the owner switches the planned needs on.', 2);
    else if (DEPENDENCY && nSup >= DEPENDENCY.heavy) add(not, 'investor', 'the map hangs ' + nSup + ' suppliers on it (' + list(F.suppliers.slice(0, 4).map((s) => s.label)) + ')' + (nLive < nSup ? ', ' + (nLive ? nLive + ' of them real inputs today' : 'none of them enforced yet') : '') + ' — this is a network business, not a set-and-forget one.', 3);
    else if (F.note.plays && (F.inputIds.length || F.screenIds.length)) /* The door is named here for the same reason as the line above: the Car
       Dealer and the Research Facility burn the same two resources and both
       open a screen, so without it they printed the identical warning. */
    add(not, 'investor', 'it needs ' + names(F, F.inputIds.concat(F.screenIds), 4) + ' kept in stock and its real value is ' + (doorShort(F) ? doorShort(F) + ', a screen you have to work' : 'a screen you have to play') + ', not a number you collect.', 2);
    else if (F.note.plays) add(not, 'investor', 'the hourly rate is the small part; what it is worth comes from ' + doorShort(F) + ', which only pays when you work it.', 1);
    if (F.note.plays && F.note.door) add(fit, 'operator', 'it opens a screen you actually play: ' + doorShort(F) + '.', F.screenIds.length ? 3 : 2);
    else if (!F.note.plays && F.kind !== 'cityTransit') add(not, 'operator', 'there is no screen behind it — once it is staffed the only thing left to do is ' + (F.inputIds.length ? 'keep ' + names(F, F.inputIds, 2) + ' in the stock room and ' : '') + 'collect the ' + (opProd || 'Cinder') + '. '
      + (F.liveSuppliers.length ? 'The work that matters happened at ' + list(F.liveSuppliers.slice(0, 2).map((s) => s.label)) + ' before it ever reached you.'
        : F.suppliers.length ? 'On the map its feedstock comes from ' + list(F.suppliers.slice(0, 2).map((s) => s.label)) + ', but nothing in the game makes that hand-over yet, so today it simply runs.'
        : 'Nothing even arrives to work on: it needs no supplier at all.'), 2);
  }
  /* Authored fits for the tiles whose point no icon captures (a bank, a
     warehouse). Words only. */
  for (const a of (F.note.fit || [])) add(fit, a[0], a[1], 3);


  /* ROUND 4: four tiles shared this line with only the numbers changed. What
     differs between them is what the slow licence BUYS, so that is the line. */
  if (earn.paybackRank && earn.paybackRank.third === 'slowest') {
    const buys = F.id === 'transport' ? 'a seat in the middle of everyone else\'s shipments, and hauls pay on top of the hourly rate'
      : F.note.plays && doorShort(F) ? doorShort(F) + ' — if you will not play that screen, the ' + fmt(earn.netPerHr) + ' Cinder an hour alone is a slow way to get ' + fmt(earn.startup) + ' back'
        : F.kind === 'cityTransit' && F.note.door ? F.note.door + ' — worth it only to a city that has outgrown what it has, never for the Cinder'
        : 'only the hourly rate, with no screen behind it to make up the difference';
    add(not, 'investor', hoursWords(earn.paybackHrs) + ' to pay back, number ' + earn.paybackRank.place + ' of ' + earn.paybackRank.of + '. What the licence buys is ' + buys + '.', 4);
  }
  if (topCustomer && !fit.some((x) => x.style === 'trader') && F.icons.market) add(fit, 'trader', topCustomer.label + ' owners are a ready buyer for ' + (names(F, topCustomer.cargo) || 'what it makes') + '.', 1);

  const dedupe = (arr) => { const seen = new Set(); return arr.sort((a, c) => c.weight - a.weight).filter((x) => (seen.has(x.style) ? false : (seen.add(x.style), true))); };
  /* A style cannot be both. A measured caution (slow payback, many suppliers)
     outranks a soft fit of the same style; otherwise the owner's icons win. */
  const n0 = dedupe(not); const f0 = dedupe(fit);
  const f = f0.filter((x) => !n0.some((y) => y.style === x.style && y.weight > x.weight));
  const n = n0.filter((x) => !f.some((y) => y.style === x.style));
  return { fitFor: f.slice(0, MAX_FIT), notFor: n.slice(0, MAX_FIT) };
}

/* ── STEPS ───────────────────────────────────────────────────────────────── */
function stepsOf(F, need, earn, partner) {
  /* trim(): a detail assembled from optional clauses ended in a space on two
     tiles in round 3. */
  const S = []; const push = (title, detail, live) => S.push({ n: S.length + 1, title: String(title).trim(), detail: String(detail || '').replace(/\s+/g, ' ').trim(), live: live !== false });
  const liveRes = need.resources.filter((r) => r.live && r.when === 'always');
  const plannedRes = need.resources.filter((r) => !r.live);
  const prod = productWords(F);

  // 1 — get the loot
  if (liveRes.length) {
    push('Get the loot: ' + list(liveRes.map((r) => r.name)),
      liveRes.map((r) => r.name + ' — ' + r.whereToFind).join(' ')
      /* A caveat folded out of these rows is said here once, not dropped. */
      + (need.notes || []).filter((n) => n.appliesTo.some((x) => liveRes.some((r) => r.name === x))).map((n) => ' ' + n.text).join('')
      + ' Stock up BEFORE you found it: an empty stock room cuts output while the wages stay the same.'
      + (plannedRes.length ? ' Planned, not needed today: ' + list(plannedRes.slice(0, 3).map((r) => r.name)) + '.' : ''));
  } else {
    push('No loot needed yet — raise the Cinder',
      F.label + ' burns no resources today, so the only thing to bring is the licence price.'
      + (plannedRes.length ? ' The owner\'s plan is for it to need battle loot: ' + list(plannedRes.slice(0, 3).map((r) => r.name)) + '. If that is switched on, start with ' + plannedRes[0].name + ' — ' + plannedRes[0].whereToFind : ''));
  }
  // 2 — found it
  push('Found it in Just Business',
    need.cinder.text + (need.aza.amount !== null ? ' ' + need.aza.text : '')
    + ' You can hold one of each business type. ' + (F.note.door ? 'Founding it opens ' + F.note.door + '.' : 'There is no extra screen: it starts earning as soon as it has workers.')
    + (earn.startSmall && earn.known && earn.startSmall.workers < earn.workers && !earn.losing ? ' Hire ' + fmt(earn.startSmall.workers) + ' workers first; add the rest ' + (F.inputIds.length ? 'once the stock room keeps up.' : 'as your Cinder allows.') : ''));
  // 3 — carrier (or its stand-in)
  if (F.id === 'transport') {
    const sup = F.suppliers.map((s) => s.label);
    push('Get rigs and a fuel deal', 'You are the carrier, so your own suppliers come first: ' + (list(sup) || 'a fuel seller and a vehicle dealer') + '. Founding grants a starter rig once per account; more rigs come off the Car Dealer\'s auction floor, and fuel is the one thing the business burns every hour.');
  } else if (F.cargoTile && !F.stashMakes.length) {
    /* ROUND 4. This branch used to need "no truck drawn" as well, so Smuggling
       (truck drawn, nothing made) fell through to "Hire a carrier for your
       Contraband" — cargo that does not exist. Nothing in a stash = nothing to
       haul, whoever drew what; the drawing only changes the first clause. */
    const drawn = !(F.truck && F.truck.basis === 'goal');
    const inP = F.suppliers.filter((s) => s.exists && !s.live && s.cargo.length).slice(0, 2);
    const inL = F.liveSuppliers.filter((s) => s.cargo.length).slice(0, 2);
    push('Transport: nothing to ship yet',
      (drawn ? 'The owner drew the truck beside ' + F.label + ', but' : 'The owner\'s written goal routes every business through a Transport company, but no truck is drawn beside ' + F.label + ' on the map and')
      + ' today it makes nothing you can hold, so there is nothing to haul out.'
      + (inL.length ? ' What does move is inbound and real: ' + inL.map((s) => names(F, s.liveCargo.length ? s.liveCargo : s.cargo, 2) + ' from ' + aan(s.label)).join('; ') + ', which you can carry yourself or put on a truck.' : '')
      + (F.wantMakes.length ? ' PLANNED: on the owner\'s plan it would deal in ' + names(F, F.wantMakes, 3) + ', and that would ride a carrier.' : '')
      + (inP.length ? ' PLANNED: ' + inP.map((s) => names(F, s.cargo, 2) + ' from ' + aan(s.label)).join('; ') + ' would arrive by carrier if the owner switches those needs on.' : ' PLANNED: if the owner switches its loot inputs on, those would arrive by carrier.')
      + ' ' + F.rule.today + ' Keep a Transport owner in your contacts, but do not pay for one now.', false);
  } else if (F.cargoTile && F.income) {
    /* What this tile SELLS is an item that changes hands on a floor or a desk,
       not cargo (recipes.js: cargoIsItem). Only the byproduct rides a truck,
       and only what is left after the operation's own burn. */
    const spare = earn.yieldsPerHr.filter((y) => F.stashMakes.indexOf(y.id) >= 0);
    const spareWords = spare.length ? list(spare.map((y) => (y.burnedPerHr > 0 ? (y.netPerHr > 0 ? 'about ' + fmt(y.netPerHr) + ' ' + y.name + ' an hour (it turns out ' + fmt(y.perHr) + ' and burns ' + fmt(y.burnedPerHr) + ' of it)' : 'no spare ' + y.name + ' (it burns all ' + fmt(y.perHr) + ' it turns out)') : fmt(y.perHr) + ' ' + y.name + ' an hour'))) : names(F, F.stashMakes, 2);
    const inbound = F.suppliers.filter((s) => s.exists && s.cargo.length && !s.cargoIsItem).slice(0, 2);
    push('Transport: only your spare ' + names(F, F.stashMakes, 2) + ' rides a truck',
      'What ' + F.label + ' sells is ' + F.income.sells + ' — ' + (F.income.handover || 'not cargo') + '. The only freight going out is the byproduct: ' + spareWords + '. '
      + (inbound.length ? 'Coming in: ' + inbound.map((s) => names(F, s.cargo, 2) + ' from ' + aan(s.label)).join('; ') + '. ' : '')
      + (F.truck && F.truck.basis === 'goal' ? 'No truck is drawn beside ' + F.label + ' on the map; it ships through Transport because the written goal says every business does. ' : 'The owner drew the truck beside ' + F.label + '. ')
      + F.rule.sentence + ' Hire a carrier for the ' + names(F, F.inputIds, 2) + ' you buy in before you think about one for what you sell.', F.rule.known && !F.rule.optional);
  } else if (F.cargoTile) {
    /* Round 1 gave every cargo tile the same paragraph. What differs between
       tiles is WHAT rides the truck, which way, in what kind of rig and whether
       the owner drew the truck — so the step is built from those, and the rule
       itself (pickup, haul, depot, deliver) is one short clause. */
    const pharma = F.id === 'medical';
    /* stashMakes is never empty here (the branch above took those tiles), so a
       planned product can no longer be the cargo in this step's title. */
    const outIds = F.stashMakes;
    const buyers = F.buyers.filter((c) => c.exists && c.id !== 'transport').slice(0, 2).map((c) => c.label);
    const inbound = F.suppliers.filter((s) => s.exists && s.cargo.length).slice(0, 2);
    const clsOf = fn(F.data.shipping, 'cargoClass');
    const RIG = { oil: 'a tanker', feed: 'a grain hopper', livestock: 'a stock wagon' };
    const rigs = clsOf ? uniq(outIds.map((x) => RIG[safe(() => clsOf(x, F.data.catalog), null)]).filter(Boolean)) : [];
    const outWords = outIds.length ? names(F, outIds, 3) : null;
    push('Hire a carrier' + (outWords ? ' for your ' + names(F, outIds, 2) : ' — a Transport company'),
      (outWords ? 'Going out: ' + outWords + (buyers.length ? ' to ' + list(buyers) + ' owners' : '') + (rigs.length ? ', which needs ' + list(rigs, 'or') + ' rather than a box truck' : '') + '. ' : 'Going out: nothing you can hold today. ')
      + (inbound.length ? 'Coming in: ' + inbound.map((s) => names(F, s.cargo, 2) + ' from ' + aan(s.label)).join('; ') + '. ' : 'Coming in: nothing the owner drew. ')
      + (F.truck && F.truck.basis === 'goal' ? 'No truck is drawn beside ' + F.label + ' on the map; it ships through Transport because the written goal says every business does. ' : 'The owner drew the truck beside ' + F.label + ': pickup, a Transport company\'s haul, the buyer\'s depot, delivery. ')
      + (pharma ? 'LIVE today for your Hospital\'s pharma wholesale: you pick a lot AND a player-owned carrier, or the sale is refused. For your other goods: ' + F.rule.today.replace(/^./, (c) => c.toLowerCase()) + ' '
        : F.rule.sentence + ' ')
      + 'Post a haul on the Haulage Board now and note which carriers answer — ' + (F.rule.known && !F.rule.optional ? 'the rule is already tightening, and' : 'if Transport becomes mandatory,') + ' that contact is the difference between selling and sitting on stock.', pharma || (F.rule.known && !F.rule.optional));
  } else if (F.kind === 'cityTransit') {
    push('Place it in your city', 'This is a city licence, not a shipper: it needs no carrier and is never a stand-in for Transport. Put ' + (F.id === 'rail' ? 'train stations and track' : 'bus stops and routes') + ' where your residents live and work.');
  } else {
    push('Set your terms (no carrier needed)', 'It ships nothing, so it needs no Transport company. What it needs is customers: decide what you charge and who you will deal with before you open the door.');
  }
  // 4 — first partner
  if (partner) {
    const cargo = partner.cargo && partner.cargo.length ? (partner.role === 'customer' && !partner.client ? sellWords(F, partner.cargo) : names(F, partner.cargo, 4)) : null;
    const backCargo = partner.back && partner.back.cargo.length ? names(F, partner.back.cargo, 3) : null;
    push('First partner: ' + aan(partner.label) + ' owner',
      (partner.client ? 'They are your ' + partner.client + (cargo && partner.client === 'tenant' ? ': they have ' + cargo + ' to keep somewhere' : '') + '. '
        : partner.role === 'customer' ? 'They are your buyer' + (cargo ? ' for ' + cargo : '') + '. ' : 'They are your supplier' + (cargo ? ' of ' + cargo : '') + '. ')
      + (partner.why ? partner.why + ' ' : '')
      + partnerStatus(F, partner) + ' '
      /* ROUND 6. The owner's map is the brief, so where the deal that works
         today is not the one drawn beside this tile, the drawn one is NAMED
         here — not left to the risks two screens down — with the reason it is
         not the first move. */
      + (partner.drawnAlt ? 'The owner drew ' + list(partner.drawnAlt.map((x) => x.label)) + ' beside ' + F.label + ' on the map, '
        + (partner.drawnAlt.every((x) => !x.live) ? 'but the game does not make ' + (partner.drawnAlt.length > 1 ? 'either of those deals' : 'that deal') + ' yet, so it is not where you start. ' : 'which is worth knowing — this one is simply the deal that already works. ') : '')
      /* A link the owner drew both ways is said as two directions, so step 6
         cannot contradict this step about who sells to whom. */
      + (backCargo ? 'It runs both ways: ' + (partner.role === 'supplier' ? 'they also buy your ' + backCargo : 'they also sell you ' + backCargo) + (partner.back.live ? '' : ' (on the owner\'s plan, not yet the game)') + '. ' : '')
      + (partner.owned ? 'You already own one, so this deal is with yourself.' : 'Open ' + partner.label + ' on this map to read its own plan, or own one yourself and keep the margin.'), partner.live);
  } else if (F.kind === 'service' || F.kind === 'cityTransit') {
    push('First partner: the people it serves', serviceWords(F) || 'It serves other players directly.');
  } else {
    push('First partner: none required', 'The owner drew no supplier beside it. It stands on its own — which is exactly why it is a good first business.');
  }
  // 5 — first sale
  const outs = outlets(F);
  const cus = F.buyers.filter((c) => c.exists && c.id !== (partner && partner.id)).slice(0, 3);
  const keptWords = earn.known && !earn.losing ? fmt(earn.netPerHr) + ' Cinder an hour kept ' + PLAN_BASIS : null;
  if (F.kind === 'cityTransit') {
    /* ROUND 7: this step used to print F.note.day, which is also the first half
       of plan.headline — and the modal prints the headline directly above the
       steps, so Bus and Rail showed the same two sentences twice on one screen.
       The step now says the thing the headline does not: there is no sale to
       make at all, and what the money actually is. */
    push('First income: the city it serves', 'There is no first sale: nothing it makes is listed on a market or loaded onto a truck, so the money is the operation\'s own hourly rate'
      + (keptWords ? ' — ' + keptWords : ', which Just Business shows') + ', collected on the usual timer. Everything else it pays you is the city itself.');
  } else if (F.income) {
    /* ROUND 4 — the critic's biggest gap. "First sale: Metal ... through the Car
       Marketplace" and "First sale: Supplies" were true to the yield row and
       wrong about the business. The first income is what the tile is FOR; the
       yield is a second line, net of the operation's own burn, and sold where a
       resource can be sold (the Marketplace) — never on the Car Marketplace. */
    const by = earn.yieldsPerHr.filter((y) => F.stashMakes.indexOf(y.id) >= 0);
    const byCus = cus.filter((c) => c.cargo.some((x) => F.stashMakes.indexOf(x) >= 0));
    const byWords = by.length ? ' Second line — the byproduct' + (F.income.byproduct ? ' (' + F.income.byproduct + ')' : '') + ': ' + list(by.map((y) => (y.burnedPerHr > 0 ? (y.netPerHr > 0 ? fmt(y.netPerHr) + ' spare ' + y.name + ' an hour after the ' + fmt(y.burnedPerHr) + ' it burns' : 'no spare ' + y.name + ' once its own burn is taken out') : fmt(y.perHr) + ' ' + y.name + ' an hour')))
      + '. It lands in your stash when you collect; list what you do not need on the Marketplace' + (byCus.length ? ', or offer it to ' + list(byCus.slice(0, 2).map((c) => aan(c.label) + ' owner'), 'or') : '') + '.'
      : (F.stashMakes.length ? ' Second line — the byproduct: ' + names(F, F.stashMakes, 2) + ' lands in your stash when you collect; list what you do not need on the Marketplace.' : '');
    push('First income: ' + F.income.title, F.income.detail + (keptWords ? ' Underneath it the operation pays ' + keptWords + '.' : '') + byWords, true);
  } else if (!F.stashMakes.length && !F.note.door && !(F.rec && F.rec.service)) {
    /* Nothing to hold and no screen (Smuggling): the income IS the rate. A
       planned product is named as planned and is never the thing to go and sell. */
    push('First income: the hourly Cinder',
      F.label + ' makes nothing you can hold today, so there is no first sale: staff it, keep ' + (names(F, F.inputIds) || 'it') + ' stocked and collect' + (keptWords ? ' — ' + keptWords : '') + '.'
      + (F.wantMakes.length ? ' PLANNED: on the owner\'s plan it would deal in ' + names(F, F.wantMakes, 3) + (F.icons.market ? ' and sell it on the Marketplace' : '') + '; there is nothing to list until then.' : ''), true);
  } else if (!F.stashMakes.length && F.note.door) {
    push('First income: ' + doorShort(F),
      /* A bank's customers are its borrowers (step 4 has just said so); the
         outlet icons describe where it sits, not who pays it. The city-only
         product used to be tacked on here — it is a catch, so it lives there. */
      /* ROUND 5: this led with NOTES.day, which is word for word the plan's own
         headline, so the brief printed the same sentence twice inside one
         screen — and on the tiles whose day text opens short ("A small
         licence.", "Your product is space.") that echo was all the step said.
         The step owes the reader what the headline does not carry: who pays,
         and what the hourly rate is worth underneath the screen. */
      (F.note.client ? 'Your ' + F.note.client + 's are other players' + (partner && partner.client ? ' — ' + partner.label + ' founders first, as in step 4' : '') + (F.sellsTo.indexOf('sys:camp') >= 0 ? ', and you meet them at camp. ' : '. ')
        : outs.length ? 'Your customers are ' + list(outs.map((x) => x.replace(/ \(.*\)$/, ''))) + '. ' : '')
      + 'Everything you earn here comes out of ' + doorShort(F) + ', so the licence is worth what you do in it.'
      + (keptWords ? ' Underneath it the operation pays ' + keptWords + '.' : ''));
  } else if (prod || outs.length) {
    push('First sale' + (prod ? ': ' + prod : ''),
      (outs.length ? 'Sell through ' + list(outs) + '. ' : '')
      + (cus.length ? 'The businesses that want it most: ' + cus.map((c) => { const w = (F.stashMakes.length ? names(F, c.cargo.filter((x) => F.stashMakes.indexOf(x) >= 0)) : names(F, c.cargo)); return c.label + (w ? ' (' + w + ')' : ''); }).join('; ') + '. ' : '')
      + (F.stashMakes.length ? 'These land in your own stash when you collect, so the first sale can be the same day.' : ''),
      !!F.stashMakes.length || !!F.sellsTo.length);
  } else {
    push('First income', serviceWords(F) || 'Its income is the hourly rate: staff it and collect.');
  }
  // 6 — scale
  /* The next link is a DIFFERENT tile from step 4's partner wherever the map
     has one, and its cargo is read in the direction it is named (round 1 told
     a Medical owner that Research was the supplier in step 4 and the customer
     in step 6). Falling back to the partner keeps step 4's own direction. */
  const pid = partner && partner.id;
  const pickNext = (rows) => rows.filter((c) => c.exists && !c.ambiguous && c.id !== 'transport' && c.id !== pid && !ownsOf(F.o.owns, c.id))[0] || null;
  const nextCus = pickNext(F.buyers); const nextSup = nextCus ? null : (pickNext(F.suppliers.filter((s) => s.live)) || pickNext(F.suppliers));
  let nextWords;
  if (nextCus || nextSup) {
    const n = nextCus || nextSup; const L = lanesWith(F.data, F.id, n.id); const lane = nextCus ? L.outbound : L.inbound;
    const ids = lane ? lane.ids.filter((x) => realRes(F.data, x)) : n.cargo;
    nextWords = 'Then own the next link: ' + aan(n.label) + (nextCus
      ? ' of your own buys your ' + (sellWords(F, ids) || 'output') + ', so you sell to yourself and keep both margins.'
      /* "You were paying for" is only true of a LIVE input; round 3 said it to a
         Smuggling owner about Research Data the game never charges. */
      : n.live ? ' of your own makes the ' + (names(F, n.liveCargo && n.liveCargo.length ? n.liveCargo : ids) || 'supplies') + ' you were paying for.'
        : ' of your own would make the ' + (names(F, ids) || 'supplies') + ' the owner has this business buying — a PLANNED link, so nothing forces the pace.');
  } else if (F.note.next) {
    nextWords = F.note.next.id ? 'Then pair it with ' + aan(F.labelOf(F.note.next.id)) + (F.note.next.id === 'transport' ? ' company' : '') + ': ' + F.note.next.why + '.' : F.note.next.why + '.';
  } else if (partner && !partner.owned) {
    nextWords = 'Then own your first partner\'s side too: ' + aan(partner.label) + ' of your own ' + (partner.role === 'supplier' ? 'makes the ' + (names(F, partner.cargo) || 'supplies') + ' you were buying in step 4.' : 'buys the ' + (names(F, partner.cargo) || 'output') + ' you were selling in step 4.');
  } else if (F.stashMakes.length) {
    nextWords = 'Then add a business that burns your spare ' + names(F, F.stashMakes, 2) + '.';
  } else nextWords = 'It makes nothing to feed a second business, so choose the next one on its own plan.';
  push('Scale up',
    (earn.losing ? 'Do not fill the worker slots for the Cinder: at the game\'s current figures the payroll outruns the take, so more workers earn nothing more. '
      : earn.known ? 'Fill all ' + fmt(earn.workers) + ' worker slots: that is ' + fmt(earn.netPerHr) + ' Cinder an hour kept, ' + PLAN_BASIS + (earn.paybackHrs !== null ? ', and the licence back in ' + hoursWords(earn.paybackHrs) : '') + '. ' : 'Fill the worker slots as your stock room allows. ')
    + nextWords
    + (F.yieldIds.indexOf('food') >= 0 && F.id !== 'restaurant' ? ' A Restaurant multiplies the food every food business you own brings in.' : ''));
  return S.slice(0, MAX_STEPS);
}

/* ── RISKS ───────────────────────────────────────────────────────────────── */
function risksOf(F, earn) {
  const R = []; const add = (title, detail, live) => R.push({ title, detail, live: live !== false });
  if (F.note.risk) add(F.note.risk.title, F.note.risk.detail, F.note.risk.live);
  if (earn.burnsPerHr.length) add('It slows down when the stock room is empty',
    'A full crew burns ' + list(earn.burnsPerHr.map((b) => fmt(b.perHr) + ' ' + b.name)) + ' an hour. Short of any of it, output drops to match the worst shortage; the ' + fmt(earn.salaryPerHr) + ' Cinder payroll does not.');
  const ghost = F.suppliers.filter((s) => !s.exists);
  if (ghost.length) add('A supplier on the map does not exist yet', list(ghost.map((s) => s.label)) + ' is on the owner\'s map but not in the game. ' + (ghost[0].sourceToday.length ? 'Until it is, you get ' + names(F, ghost[0].cargo) + ' from ' + list(ghost[0].sourceToday.map(F.labelOf)) + ' or from battle loot.' : 'Plan around battle loot for ' + (names(F, ghost[0].cargo) || 'its goods') + '.'), false);
  /* ROUND 4. Stock the business's own screen really uses today and that NO tile
     on the owner's map makes. recipes.js and coverage.js are where that is
     fixed; the plan is where a player meets it, so it is said as a catch. */
  if (F.orphanStock && F.orphanStock.length) add('Some of its screen stock has no supplier on the map', names(F, F.orphanStock, 6) + (F.orphanStock.length > 1 ? ' are' : ' is') + ' really used on ' + (screenName(F) || 'its own screen') + ' today, no business on the owner\'s map makes ' + (F.orphanStock.length > 1 ? 'them' : 'it') + ' and there is no place to aim for ' + (F.orphanStock.length > 1 ? 'them' : 'it') + ' in loot. A lucky pull is the only source until the owner gives ' + (F.orphanStock.length > 1 ? 'them' : 'it') + ' a maker.');
  if (F.deadEnds && F.deadEnds.length) add('A planned need leads nowhere yet', names(F, F.deadEnds, 4) + ': on the owner\'s plan this business would use ' + (F.deadEnds.length > 1 ? 'them' : 'it') + ', but nothing on the map makes ' + (F.deadEnds.length > 1 ? 'them' : 'it') + ' and there is no place to aim for ' + (F.deadEnds.length > 1 ? 'them' : 'it') + ' in loot. It is on the owner\'s list to give ' + (F.deadEnds.length > 1 ? 'each' : 'it') + ' a source before that need is switched on.', false);
  /* ROUND 5: "Thin margin" was the title whether wages took most of the take or
     more than all of it. Under water is a different fact and gets its own. */
  if (earn.known && earn.losing) add('The payroll outruns the take', 'At the game\'s current figures a full crew costs ' + fmt(earn.shortfallPerHr) + ' Cinder an hour more than it brings in. The game does not bill you the difference, but it pays you nothing either, so the hourly collect is zero however many workers you hire' + (F.note.plays && doorShort(F) ? '; the value is all in ' + doorShort(F) + '.' : '.'));
  else if (earn.marginBand === 'thin') add('Thin margin', 'Wages take most of what each worker brings in, so a dip in the market can wipe out the profit.');
  if (earn.paybackRank && earn.paybackRank.third === 'slowest') add('Slow to pay back', 'Number ' + earn.paybackRank.place + ' of ' + earn.paybackRank.of + ' businesses for payback speed: ' + hoursWords(earn.paybackHrs) + ' ' + PLAN_BASIS + '.');
  if (F.phantomYields.length) add('Part of its output goes nowhere', 'The game\'s table has it yielding ' + list(F.phantomYields) + ', which is in no resource catalogue, so that part of the payout is silently dropped today. Fixing it is on the owner\'s list.');
  if (!F.stashMakes.length && F.cityMakes.length && !(F.kind === 'producer' && !(F.rec && F.rec.service))) add('Its city product never reaches your stash', names(F, F.cityMakes) + (F.cityMakes.length > 1 ? ' are' : ' is') + ' made only when the business is placed as a tile inside a city, and ' + (F.cityMakes.length > 1 ? 'stay' : 'stays') + ' inside that city\'s economy. What comes out to you is Cinder.');
  if (!F.stashMakes.length && F.kind === 'producer' && !(F.rec && F.rec.service)) add('It makes nothing you can hold', 'Its only product is Cinder' + (F.cityMakes.length ? ' (' + names(F, F.cityMakes) + (F.cityMakes.length > 1 ? ' exist' : ' exists') + ' only inside a city\'s economy)' : '') + ', so it cannot feed another business of yours.');
  if (DEPENDENCY && F.suppliers.length >= DEPENDENCY.heavy) add('Many moving parts', 'The map hangs ' + F.suppliers.length + ' suppliers on it. Today most of those deals are optional; if the owner switches the planned inputs on, every one becomes a stock line to keep filled.', false);
  if (F.id === 'transport') add('Your work depends on other players shipping', 'Hauls come from other players\' requests. ' + (F.rule.known && !F.rule.optional ? 'The carrier rule is past its first stage, but a local run can still be hand-hauled, so quiet days are possible.' : F.rule.known ? 'Today nobody is made to hire a carrier (except Hospital pharma wholesale and cure waybills), so quiet days are possible.' : 'How far the game makes anyone hire a carrier today was not available here, so assume quiet days are possible.'));
  if (F.cargoTile && F.id !== 'transport' && !F.nothingToShip) add(F.rule.known && !F.rule.optional ? 'Transport is tightening' : 'Transport may become mandatory', F.rule.risk, F.rule.known && !F.rule.optional);
  return R.slice(0, MAX_RISKS);
}

/* verdictFor(profile) — every key is optional:
     style | styles  a PLAYSTYLES id, or several
     cinder | gems   the player's Cinder (number or thunk; `gems` is the bridge's name)
     aza             the player's Aza (number or thunk)
     held            (id) => number or an {id: number} map; defaults to planFor's `held`
     passive         true = wants set-and-forget, false = wants a screen to play */
export const VERDICT_PROFILE_KEYS = Object.freeze(['style', 'styles', 'cinder', 'gems', 'aza', 'held', 'passive']);

/* ── VERDICT ─────────────────────────────────────────────────────────────── */
function makeVerdict(plan, o) {
  const altCache = {};
  const alternativesFor = (style) => {
    if (altCache[style]) return altCache[style];
    const out = [];
    for (const b of bizRows(o.data || {})) {
      if (!b || b.id === plan.id || b.status === 'planned' || ownsOf(o.owns, b.id)) continue;
      const p = safe(() => planFor(b.id, o), null); const hit = p && p.fitFor.find((x) => x.style === style);
      if (hit) out.push({ id: b.id, label: p.label, weight: hit.weight || 0, place: p.earn && p.earn.paybackRank ? p.earn.paybackRank.place : Infinity });
    }
    out.sort((a, c) => (c.weight - a.weight) || (a.place - c.place));
    return (altCache[style] = out.slice(0, MAX_FIT));
  };
  return function verdictFor(profile) {
    try {
      const p = isObj(profile) ? profile : {};
      const styles = uniq([].concat(p.styles || [], p.style || []).filter((s) => typeof s === 'string' && own(STYLE, s)));
      const reasons = [];
      const hit = plan.fitFor.filter((f) => styles.indexOf(f.style) >= 0);
      const clash = plan.notFor.filter((f) => styles.indexOf(f.style) >= 0);
      const first = plan.steps[0] ? plan.steps[0].title : null;
      if (plan.status === 'planned') {
        /* ROUND 6. This led with plan.headline, which a modal prints in
           italics immediately above this card — the same sentence twice in one
           card, the defect already fixed for step 5 on door tiles. The card now
           carries what the headline cannot: who it would suit, and (through
           firstAction) what exists today instead. */
        const would = hit.length ? hit.map((h) => 'It would suit you as a ' + h.label.toLowerCase() + ': ' + h.why)
          : [(plan.fitFor || []).length ? 'If it ever ships it would suit ' + list(plan.fitFor.map((f) => aan(f.label.toLowerCase())), 'or') + '.' : 'Who it would suit cannot be told until it exists.'];
        return { verdict: 'not-yet', label: 'Not in the game yet', headline: plan.label + ' is on the owner\'s map but cannot be founded today.',
          reasons: would, afford: UNKNOWN, stock: UNKNOWN, firstAction: plan.steps[4] ? plan.steps[4].detail : first };
      }
      if (plan.kind !== 'business') {
        return { verdict: clash.length && !hit.length ? 'maybe' : 'yes', label: 'Open to everyone', headline: 'There is nothing to buy: ' + plan.label + ' is a part of the game you take part in.',
          reasons: hit.map((h) => h.text).concat(clash.map((c) => 'Less for you as a ' + c.label.toLowerCase() + ': ' + c.why)), afford: 'ready', stock: 'none-needed', firstAction: first };
      }
      /* ROUND 4. `{gems: n}` was silently read as "Cinder not supplied" because
         the key here is `cinder` and the bridge calls it gems. Both are taken
         (a number or a thunk), and any key this function does not know comes
         back in `ignored` so the modal piece sees its typo instead of a
         quietly worse verdict. Shape: VERDICT_PROFILE below. */
      const num = (v) => fin(typeof v === 'function' ? safe(() => v(), null) : v);
      const ignored = Object.keys(p).filter((k) => VERDICT_PROFILE_KEYS.indexOf(k) < 0);
      const cinder = num(p.cinder) !== null ? num(p.cinder) : num(p.gems) !== null ? num(p.gems) : plan.needToStart.cinder.held;
      const ask = plan.needToStart.cinder.amount;
      const aza = num(p.aza), azaAsk = plan.needToStart.aza.amount;
      let afford = UNKNOWN;
      if (AFFORD && ask !== null && cinder !== null) afford = ask <= 0 || cinder / ask >= AFFORD.ready ? 'ready' : cinder / ask >= AFFORD.close ? 'close' : 'far';
      const byAza = azaAsk !== null && aza !== null && aza >= azaAsk;
      if (byAza) afford = 'ready';
      const held = p.held !== undefined ? p.held : o.held;
      const always = plan.needToStart.resources.filter((r) => r.live && r.when === 'always');
      const has = (r) => { const h = heldOf(held, r.id); return h !== null && h > 0; };
      const share = always.length ? always.filter(has).length / always.length : 1;
      const stock = !always.length ? 'none-needed' : held === undefined || held === null || !INPUTS_HELD ? UNKNOWN : share >= INPUTS_HELD.ready ? 'ready' : share >= INPUTS_HELD.partial ? 'partial' : 'empty';

      hit.forEach((h) => reasons.push('Fits you as a ' + h.label.toLowerCase() + ': ' + h.why));
      clash.forEach((c) => reasons.push('Works against you as a ' + c.label.toLowerCase() + ': ' + c.why));
      if (byAza) reasons.push('You can pay the ' + fmt(azaAsk) + ' Aza price now.');
      else if (afford === 'ready') reasons.push('You can afford the licence now (' + fmt(ask) + ' Cinder).');
      else if (afford === 'close') reasons.push('You hold ' + fmt(cinder) + ' of the ' + fmt(ask) + ' Cinder licence — over half way.');
      else if (afford === 'far') reasons.push('You hold ' + fmt(cinder) + ' of the ' + fmt(ask) + ' Cinder licence — a long way off.');
      else reasons.push('Whether you can afford it is unknown — ' + (ask === null ? 'the licence price was not available.' : 'your Cinder was not supplied.'));
      /* "You hold it" is not "you are stocked": 50 Fuel against 14 an hour is an
         afternoon. Hours of cover is the row's own burn divided into the stash. */
      const cover = always.map((r) => { const h = heldOf(held, r.id); const per = pos(r.perHrFullCrew); return h !== null && h > 0 && per !== null ? { name: r.name, held: h, hrs: h / per } : null; }).filter(Boolean);
      const coverWords = cover.length ? ' At full crew that is ' + list(cover.map((c) => hoursWords(c.hrs).replace(/ of running$/, '') + ' of ' + c.name + ' (' + fmt(c.held) + ' held)')) + ' before output starts to fall.' : '';
      if (stock === 'ready') reasons.push('You hold every resource it burns (' + list(always.map((r) => r.name)) + ').' + coverWords);
      else if (stock === 'partial') reasons.push('You hold some of what it burns; still missing ' + list(always.filter((r) => !has(r)).map((r) => r.name)) + '.' + coverWords);
      else if (stock === 'empty') reasons.push('You hold none of what it burns (' + list(always.map((r) => r.name)) + ') — it would start throttled.');
      const wrongPace = (p.passive === true && plan.effort === 'active') || (p.passive === false && plan.effort === 'passive');
      if (wrongPace) reasons.push(p.passive ? 'You asked for something passive; this one\'s value is in a screen you have to play.' : 'You asked for something to play; this one is found, staff, collect.');
      if (plan.owned) reasons.push('You already own one — and you can only hold one of each type.');

      let verdict;
      if (plan.owned) verdict = 'no';
      else if (styles.length && clash.length && !hit.length) verdict = 'no';
      else if (wrongPace && !hit.length) verdict = 'no';
      else if (afford === 'far') verdict = 'not-yet';
      else if (afford === 'ready' && (hit.length || !styles.length) && !wrongPace && stock !== 'empty') verdict = 'yes';
      else verdict = 'maybe';
      const label = plan.owned ? 'You already own it' : { yes: 'Yes — start it', maybe: 'Maybe — read the catches', 'not-yet': 'Not yet — save up first', no: 'Probably not for you' }[verdict];
      let firstAction;
      if (plan.owned) firstAction = plan.steps[plan.steps.length - 1] ? plan.steps[plan.steps.length - 1].detail : null;
      else if (verdict === 'not-yet') firstAction = 'Raise ' + fmt(Math.max(0, ask - cinder)) + ' more Cinder' + (always.length ? ' and bank some ' + list(always.map((r) => r.name)) + ' while you do' : '') + '.';
      else if (verdict === 'no') {
        /* "Look elsewhere" is not a first action; naming where is. The other
           plans are built only here, on a "no", and only once per plan. */
        const alt = styles.length ? alternativesFor(styles[0]) : [];
        firstAction = alt.length ? 'Open ' + list(alt.map((a) => a.label), 'or') + ' instead: ' + (alt.length > 1 ? 'those are' : 'that is') + ' the ' + (alt.length > 1 ? 'businesses' : 'business') + ' on this map whose plan is strongest for a ' + STYLE[styles[0]].label.toLowerCase() + '.'
          : 'Look on the map for a business whose plan names a ' + (styles.length ? STYLE[styles[0]].label.toLowerCase() : 'player like you') + ' under "for you if".';
      }
      else if (stock === 'empty' || stock === 'partial') firstAction = first + '.';
      else firstAction = plan.steps[1] ? plan.steps[1].title + '.' : first;
      return tidy({ verdict, label, headline: label + ': ' + plan.label + '.', reasons, afford, stock, coverHrs: cover.map((c) => ({ name: c.name, hrs: c.hrs })), firstAction, ignored });
    } catch (e) {
      return { verdict: 'maybe', label: 'Maybe — read the plan', headline: plan.label, reasons: [], afford: UNKNOWN, stock: UNKNOWN, firstAction: null };
    }
  };
}

/* ── SYSTEMS + CHANNELS — "how to take part" ──────────────────────────────── */
const PART = Object.freeze({
  'sys:battle': { fit: ['battler', 'trader'], not: ['investor'],
    fitWhy: { battler: 'this is your home: every fight can end with resources in your pack.', trader: 'loot you do not need is stock to sell — business owners are the map\'s named best buyers for it.' },
    notWhy: { investor: 'nothing here ticks over on its own; loot only comes from fights you play.' },
    steps: [
      ['Build a deck that survives', 'Loot only counts if you bring it home. A deck that wins keeps its haul.'],
      ['Fight where the loot you want drops', null],
      ['Carry more home', 'A better backpack on your hero raises every line of a battle haul, and the harvest choice after a fight lets you aim for staples.'],
      ['Sell to business owners', 'The owner\'s map names Business Players as the best buyers of battle loot. List spare loot on the Marketplace, or deal directly with an owner whose business burns it.'],
      ['Or feed your own business', null],
    ] },
  'sys:business': { fit: ['operator', 'trader', 'investor'], not: [],
    fitWhy: { operator: 'most businesses open a screen of their own — a hospital, a refinery, a farm, a car line.', trader: 'every business makes something to sell, and the map marks most of them for the Marketplace.', investor: 'a few businesses need nothing but staff; they are the quiet earners.' },
    notWhy: {},
    steps: [
      ['Pick one tile and read its plan', 'Every business on this map has its own plan like this one. Start with one that burns what you already hold.'],
      ['Raise the licence price', 'Each business is bought once, with Cinder (a few also take Aza). The live price is on the tile.'],
      ['Found it and hire a small crew', 'Workers are paid every hour whether or not the stock room is full, so start small.'],
      ['Find your first partner and a carrier', 'The map shows who supplies you and who buys from you. Transport sits in the middle of it.'],
      ['Collect, sell, then add the next link', 'City Builders are the map\'s named best buyers for what businesses make.'],
    ] },
  'sys:city': { fit: ['builder', 'investor'], not: ['battler'],
    fitWhy: { builder: 'this is your system: a city laid out around what it produces.', investor: 'the map\'s own words: a well-designed city generates passive Cinder for its owner.' },
    notWhy: { battler: 'a city makes nothing you can take into a fight; what it makes stays inside the city\'s economy and only the Cinder comes out.' },
    steps: [
      ['Claim a node and lay out a city', 'Roads, power and homes first; a city with no road out cannot post new Marketplace lots.'],
      ['Place business tiles', 'Any business you own can be placed as a city tile, where it founds a firm inside the city\'s economy.'],
      ['Own a Construction Company early', 'Each of its workers is one more build slot.'],
      ['Add transit', 'A Bus Company or Rail Road lets residents and NPC trade reach other cities and camps. The map also makes one of them (or an Airport) the condition for hiring from camps — PLANNED, not enforced today.'],
      ['Collect the city\'s Cinder', 'City resources never leave the city; the audited Cinder payout does. Trainers and battlers are the map\'s named best buyers.'],
    ] },
  'sys:camp': { fit: ['trainer', 'battler'], not: ['investor'],
    fitWhy: { trainer: 'this is your system: units get stronger here and come back from missions with resources.', battler: 'a stronger deck survives more fights, and a survived fight is loot brought home.' },
    notWhy: { investor: 'a camp pays back in stronger units, not in Cinder per hour.' },
    steps: [
      ['Level your units', 'Stronger units are worth more and survive more.'],
      ['Send units on missions', 'Missions are the second source of resources beside battle, and every mission also pulls from the whole salvage table.'],
      ['Use what businesses unlock at camp', 'A Genetics Lab owner opens the DNA Lab, a Dojo owner the Dojo Shop, a Bank owner Bank Row.'],
      ['Sell what missions bring back', 'The owner\'s map names Business owners as the best buyers of what a camp produces.'],
      ['Go back to battle stronger', 'The loop the map describes: camp, battle, loot, business, city, camp.'],
    ] },
  'ch:market': { fit: ['trader', 'battler'], not: [],
    fitWhy: { trader: 'this is your floor: lots priced in Cinder, Aza, swaps or barter.', battler: 'it is where spare loot turns into Cinder.' },
    notWhy: {},
    steps: [
      ['Open the Resource Exchange in the Ruin Exchange', 'Anyone can list; no licence is needed.'],
      ['List what you have spare', 'Listing slots are limited and a Trader Membership raises the limit.'],
      ['Price against the map', 'Open a resource on this map to see which businesses burn it — those owners are your buyers.'],
      ['Know what happens on a sale', 'LIVE: a Marketplace sale lands in the buyer\'s stash instantly, with no haul. PLANNED: the owner\'s goal routes business-to-business sales through a Transport company.'],
      ['Reinvest', 'The legend calls the Marketplace "best to make money"; the businesses with its icon are the ones built to sell here.'],
    ] },
  'ch:carmarket': { fit: ['trader', 'hauler'], not: [],
    fitWhy: { trader: 'vehicles are the big-ticket items of the map.', hauler: 'rigs are bought here.' },
    notWhy: {},
    steps: [
      ['Own or find a Car Dealer', 'The auction floor (Prince Portfolios) belongs to the Car Dealer business.'],
      ['Buy at auction, sell player to player', 'The player-to-player vehicle market is live.'],
      ['Supply hauliers', 'Every Transport company needs rigs, and they come off this floor.'],
      ['Watch the Car Factory', 'PLANNED: selling a player-built car through a dealer is not live yet.'],
      ['Use the tow-truck icon as your guide', null],
    ] },
});

function partPlan(id, o) {
  const data = o.data || {}; const row = sysRow(data, id); const part = PART[id];
  const label = (row && row.label) || id;
  const labelOf = (x) => ((bizRow(data, x) || {}).label || x);
  const mk = (style, why) => ({ style, label: STYLE[style].label, why, text: STYLE[style].label + ' — ' + why });
  const steps = part.steps.map((s, i) => ({ n: i + 1, title: s[0], detail: s[1], live: true }));
  const resources = []; let partNotes = [];
  if (id === 'sys:battle') {
    /* What is worth fighting for = the loot the most businesses really burn
       today, counted from the injected rows, and where loot.js says it drops. */
    const tally = {};
    for (const b of bizRows(data)) {
      if (!b || b.status === 'planned') continue;
      const r = rowOf(o.opEcon, b.id, null); const rec = recipeOf(data, b.id);
      const ids = r && isObj(r.inputs) ? Object.keys(r.inputs) : (r ? [] : (rec && Array.isArray(rec.upkeep) ? rec.upkeep.filter((u) => u.via === 'opsInput').map((u) => u.id) : []));
      for (const x of ids) if (realRes(data, x)) (tally[x] || (tally[x] = [])).push(b.id);
    }
    const top = Object.keys(tally).sort((a, c) => tally[c].length - tally[a].length).slice(0, MAX_PLANNED_NEEDS);
    for (const x of top) {
      const w = whereToFind(data, x, null, labelOf);
      /* Fresh Fish is burned by a business but landed at camp, not won in a fight. */
      if (w.system !== 'sys:battle') continue;
      resources.push({ id: x, name: resName(data, x), icon: resIcon(data, x), live: true, when: 'sell', whereToFind: w.text, _how: w.how, _label: w.label, _tail: w.tail, whereSource: w.source, whereSystem: w.system, lootable: w.lootable, aimable: w.aimable, madeBy: w.madeBy, held: heldOf(o.held, x),
        why: tally[x].length + (tally[x].length === 1 ? ' business burns' : ' businesses burn') + ' it every hour today (' + andMore(tally[x].slice(0, 4).map(labelOf), tally[x].length > 4 ? 'more' : null) + '), so it always has a buyer.' });
    }
    partNotes = foldRepeats(resources);
    steps[1].detail = resources.length ? resources.slice(0, 3).map((r) => r.name + ' — ' + r.whereToFind).join(' ') : 'Different ruins and different fallen units carry different loot; open a resource on this map to see where it drops.';
    steps[4].detail = resources.length ? 'If you are swimming in ' + list(resources.slice(0, 2).map((r) => r.name)) + ', a business that burns it turns loot into hourly Cinder: ' + list(uniq([].concat(...resources.slice(0, 2).map((r) => tally[r.id]))).slice(0, 4).map(labelOf)) + '.' : 'A business that burns what you loot turns it into hourly Cinder.';
  }
  if (id === 'ch:carmarket') {
    const marked = bizRows(data).filter((b) => b && b.icons && b.icons.carMarket).map((b) => b.label);
    steps[4].detail = marked.length ? 'The owner marked ' + list(marked) + ' with it.' : 'The businesses carrying the tow-truck icon are the ones tied to this market.';
  }
  const plan = {
    id, label, kind: id.indexOf('ch:') === 0 ? 'channel' : 'system', status: 'live',
    headline: (row && (row.blurb || row.legend)) || label,
    bestBuyers: row && row.bestBuyers ? row.bestBuyers : null,
    basis: PLAN_BASIS,
    fitFor: part.fit.map((s) => mk(s, part.fitWhy[s])), notFor: part.not.map((s) => mk(s, part.notWhy[s])),
    needToStart: {
      cinder: { amount: 0, known: true, held: null, afford: 'ready', text: 'Nothing to buy — this is a part of the game, not a licence.', live: true },
      aza: { amount: null, known: true, text: 'None.', live: true }, resources, notes: partNotes, businesses: [],
    },
    steps: steps.slice(0, MAX_STEPS),
    earn: blankEarn(null, 'No hourly rate: what you earn here depends on what you ' + (id === 'sys:battle' ? 'win and carry home' : id === 'sys:camp' ? 'train and send out' : id === 'sys:city' ? 'build' : id === 'sys:business' ? 'found — each business tile has its own figures' : 'list and at what price') + '. Nothing here is a guess.'),
    risks: id === 'sys:battle' ? [{ title: 'Lose the fight, lose the haul', detail: 'Loot only counts once it is home; a lost battle or a risky tombstone can cost what you were carrying.', live: true }] : [],
    effort: 'active', effortWhy: 'You take part by playing it.',
  };
  plan.summary = summaryOf(plan, null);
  tidy(plan);
  plan.verdictFor = makeVerdict(plan, o);
  plan.text = planText(plan);
  return plan;
}

/* ── PLANNED tiles — honest, and number-free ──────────────────────────────── */
function plannedPlan(F, o) {
  const note = F.note;
  /* F.row is null for a planned tile by construction (gather), so earnOf can
     only answer "unknown". Even a caller that injects a row for 'fashion' gets
     no figure: there is no such operation for the row to describe. */
  const earn = earnOf(F);
  const fit = fitOf(F, earn);
  const rn = resourceNeeds(F, o, earn); const resources = rn.rows;
  F.derived = derivedSuppliers(F, rn);
  /* Tier 0 rows are the ones a reader can act on; step 3 leads with them and
     names who makes them, instead of quoting the first row whatever it is. */
  const reach = resources.filter((r) => r.tier === 0);
  const supWords = F.derived.length ? ' ' + F.derived.map((d) => d.why).join(' ') : '';
  const makers = F.wantMakes.length ? uniq([].concat(...F.wantMakes.map((x) => stashProducers(F.data, x)))) : [];
  const steps = [
    /* ROUND 6. A view prints LIVE / PLANNED beside every step from `live`.
       Steps 1 and 5 are things a reader can act on TODAY about a tile that does
       not exist, so they are correctly live — but the title asserted the
       opposite ("Know what it is: not in the game yet  LIVE"), which reads as a
       contradiction under the tile's own PLANNED stamp. The fact moved into the
       detail, where no badge argues with it. */
    /* ROUND 7. Round 6 moved "not in the game yet" out of the title because a
       LIVE badge beside it read as a contradiction — but the badge itself is
       what the player sees, and "Read this first LIVE" on a tile stamped
       PLANNED was the same contradiction with the informative half removed. The
       badge on these steps answers one question only: is this step part of the
       shipped game. Step 1 describes a business that is not, so it is PLANNED
       and its title can say so; step 5 is a thing you really can do today and
       stays LIVE. */
    { n: 1, title: 'What it is: the owner\'s map, not the game yet', detail: F.label + ' is drawn on the owner\'s map but cannot be founded today. Adding it is the owner\'s decision; its price, wages and rate will be set then. Nothing below is a number, on purpose.', live: false },
    /* Round 6's step 2 was `note.would` verbatim, which is also the tail of
       plan.headline — and the modal prints the headline above the steps, so one
       screen carried the same sentence three times. The headline keeps the
       owner's sentence; this step says the same thing in DATA instead: what it
       would make, who the owner drew buying it, who would supply it. */
    { n: 2, title: F.cargoTile ? 'What it would make, and who would buy it' : 'Who it would serve', detail: wouldDo(F) || note.would || 'As drawn on the map.', live: false },
    { n: 3, title: 'What it would need', detail: resources.length ? 'On the owner\'s plan it would run on ' + list(resources.slice(0, 5).map((r) => r.name)) + '.' + supWords + ' ' + (reach.find((r) => r.aimable) || reach[0] || resources[0]).name + ' — ' + (reach.find((r) => r.aimable) || reach[0] || resources[0]).whereToFind : 'Its inputs are not decided.', live: false },
    { n: 4, title: F.cargoTile ? 'It would ship through Transport' : 'It would work only for a city', detail: F.cargoTile ? 'The truck is drawn beside it: pickup, haul by a Transport company, depot, delivery' + (F.customers.length ? ' — first of all to ' + list(F.customers.map((c) => c.label + (c.cargo.length ? ' (' + names(F, c.cargo) + ')' : ''))) : '') + '.' : 'Like the Bus Company and the Rail Road it would carry no business cargo and never stand in for Transport.', live: false },
    { n: 5, title: 'What you can do today instead', detail: (note.today || 'Nothing yet.') + (makers.length ? ' Already in the game: ' + list(makers.map((m) => F.labelOf(m) + ' makes ' + names(F, F.wantMakes.filter((x) => stashProducers(F.data, x).indexOf(m) >= 0)))) + '.' : ''), live: true },
  ];
  const plan = {
    id: F.id, label: F.label, kind: 'business', status: 'planned', tileKind: F.kind,
    headline: 'Not in the game yet — here is what it would be. ' + (note.would || ''),
    makes: productWords(F), basis: PLAN_BASIS,
    fitFor: fit.fitFor.map((f) => Object.assign({}, f, { planned: true, text: f.text.replace(' — ', ' (if it ships) — ') })), notFor: fit.notFor,
    needToStart: { cinder: cinderNeed(F, o), aza: azaNeed(F), resources, notes: rn.notes, screenMore: null, businesses: businessNeeds(F) },
    steps, earn,
    risks: [{ title: 'It may change before it ships', detail: 'Everything here is the owner\'s map read literally. Until the business exists, none of it can be relied on.', live: false }],
    effort: 'passive', effortWhy: 'Unknown until it exists; there is nothing to run today.',
    owned: false, customers: F.customers, suppliers: F.suppliers.concat(F.derived), firstPartner: firstPartner(F),
  };
  plan.summary = summaryOf(plan, F);
  tidy(plan);
  plan.verdictFor = makeVerdict(plan, o);
  plan.text = planText(plan);
  return plan;
}

/* ── SUMMARY — the bottom line, for above the fold ────────────────────────── */
/* A full plan is two to three screens at card width. The hover card has room
   for four lines and the modal wants them before the scroll: should I, what
   first, what it costs, what it keeps. Every figure is the same derived one the
   long plan prints — nothing new is computed here, only chosen. */
function summaryOf(plan, F) {
  const need = plan.needToStart || {}; const earn = plan.earn || {};
  const fitL = (plan.fitFor || []).map((f) => aan(f.label.toLowerCase())); const notL = (plan.notFor || []).map((f) => aan(f.label.toLowerCase()));
  const always = (need.resources || []).filter((r) => r.live && r.when === 'always');
  let should, first, costs, keeps;
  if (plan.status === 'planned') {
    should = 'You cannot start it: it is on the owner\'s map but not in the game yet.' + (fitL.length ? ' If it ships it would suit ' + list(fitL, 'or') + '.' : '');
    first = (F && F.note.today) || 'Nothing to do yet.';
    costs = 'Not set — the owner has not priced it.';
    keeps = 'Unknown until it exists. Nothing here is a guess.';
  } else if (plan.kind !== 'business') {
    should = 'Yes — there is nothing to buy; everyone can take part.' + (fitL.length ? ' It pays back most for ' + list(fitL, 'or') + '.' : '');
    first = plan.steps[0] ? plan.steps[0].title + '.' : '';
    costs = 'Nothing.';
    keeps = earn.text || 'No hourly rate.';
  } else {
    should = (fitL.length ? 'Start it if you are ' + list(fitL, 'or') + '.' : 'It suits no play style strongly.') + (notL.length ? ' Think twice if you are ' + list(notL, 'or') + '.' : '')
      + (earn.losing ? ' At the game\'s current figures its payroll outruns its take, so it earns nothing on its own.' : '');
    first = plan.steps[0] ? plan.steps[0].title + /* A PLANNED partner is not the second thing to do (the Car Dealer's Car Factory
       hand-off is not even live); founding it is. */
      (plan.firstPartner && plan.firstPartner.live ? ', then look for ' + aan(plan.firstPartner.label) + ' owner' : ', then found it in Just Business') + '.' : '';
    const c = need.cinder || {}; const a = need.aza || {};
    costs = (c.amount !== null && c.amount !== undefined ? fmt(c.amount) + ' Cinder' + (a.amount ? ' (or ' + fmt(a.amount) + ' Aza)' : '') + ' for the licence' : 'Licence price unknown — Just Business shows it')
      + (always.length ? ', plus ' + list(always.map((r) => (r.perHrFullCrew !== null ? fmt(r.perHrFullCrew) + ' ' : '') + r.name)) + (always.some((r) => r.perHrFullCrew !== null) ? ' an hour' : '') + ' kept in stock.' : ', and nothing to keep in stock.');
    keeps = earn.known ? fmt(earn.netPerHr) + ' Cinder an hour ' + PLAN_BASIS + (earn.paybackHrs !== null ? '; the licence is back in ' + hoursWords(earn.paybackHrs) + '.' : '; on its own it never pays the licence back.')
      : 'Unknown — the game\'s figures were not available. Nothing here is a guess.';
  }
  return { should, first, costs, keeps, text: ['Should I? ' + should, 'Do first: ' + first, 'Costs: ' + costs, 'Keeps: ' + keeps].join('\n') };
}
/* ── (no mid tier) ──────────────────────────────────────────────────────────
   ROUND 4 built plan.brief, a one-screen tier between the four-line summary and
   the three-screen plan. ROUND 6 deleted it: it was not in the lead contract
   and no module in this folder ever read it (modal.js prints summary, steps,
   fitFor / notFor, risks, earn and verdictFor), so every assertion about it was
   testing output no player could reach. A view that wants one screen prints
   plan.summary plus plan.steps.slice(0, 3), which the modal already renders. */
/* A label that ends in a full stop ("Agricultural Op.") met a sentence that adds
   its own in three steps of round 2. Every string a plan carries is built from
   injected labels, so the stray ".." is scrubbed once, where the plan is
   finished, instead of at each of the forty places a label is interpolated.
   An ellipsis (three dots) is left alone. */
function tidy(v, depth) {
  const d = depth || 0; if (d > 6 || !isObj(v)) return v;
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (typeof x === 'string') {
      if (k !== 'id' && x.indexOf('..') >= 0) v[k] = x.replace(/([^.])\.\.(?!\.)/g, '$1.');
      /* ROUND 4: one business, two names. The tile is Home Feed and the screen
         it opens is the Homestead Farm; sibling files say "the Homestead" on
         its own, which a reader takes for a second business. Said in full. */
      if (k !== 'id' && /[Tt]he Homestead(?! Farm)\b/.test(v[k])) v[k] = v[k].replace(/\b[Tt]he Homestead(?! Farm)\b/g, 'Home Feed\'s farm (the Homestead Farm screen)');
    } else if (isObj(x) && !Object.isFrozen(x)) tidy(x, d + 1);
  }
  return v;
}

/* ── planText — the whole plan as plain words ─────────────────────────────── */
/* For the screen-reader view, the fallback view and the critic's "can a reader
   decide from the text alone" test. Views may ignore it and lay the object out
   themselves; nothing is in the text that is not in the object. */
export function planText(plan) {
  if (!isObj(plan)) return '';
  const L = [];
  const tag = (live) => (live === false ? ' [PLANNED]' : '');
  L.push(plan.label + (plan.status === 'planned' ? ' — NOT IN THE GAME YET' : ''));
  if (plan.headline) L.push(plan.headline);
  if (plan.makes) L.push('Makes: ' + plan.makes + '.');
  if (plan.summary) L.push('', 'BOTTOM LINE', ...plan.summary.text.split('\n').map((x) => '  ' + x));
  if (plan.fitFor && plan.fitFor.length) { L.push('', 'FOR YOU IF YOU ARE A'); plan.fitFor.forEach((f) => L.push('  + ' + f.text)); }
  if (plan.notFor && plan.notFor.length) { L.push('', 'NOT FOR YOU IF YOU ARE A'); plan.notFor.forEach((f) => L.push('  - ' + f.text)); }
  const n = plan.needToStart || {};
  L.push('', 'WHAT YOU NEED TO START');
  if (n.cinder) L.push('  Cinder: ' + n.cinder.text);
  if (n.aza && n.aza.amount !== null) L.push('  Aza: ' + n.aza.text);
  /* What is really charged today comes first and in full. The owner's planned
     loot needs are a short secondary list under ONE heading that says they are
     planned, instead of a tag and a sentence on every row. */
  const res = n.resources || [];
  res.filter((r) => r.live !== false && r.when !== 'screen').forEach((r) => L.push('  ' + r.name + ': ' + r.why + ' WHERE: ' + r.whereToFind));
  /* Screen-only stock sits under ONE heading naming the screen, so nobody reads
     Cloth as something the hourly operation burns. */
  const scr = res.filter((r) => r.live !== false && r.when === 'screen');
  if (scr.length) { L.push('  ON THE SCREEN YOU PLAY' + (scr[0].screen ? ' (' + scr[0].screen + ')' : '') + ' — not needed by the hourly operation:'); scr.forEach((r) => L.push('    ' + r.name + ': ' + r.why + ' WHERE: ' + (r.whereShort || r.whereToFind))); }
  if (n.screenMore) L.push('    ' + n.screenMore.text);
  (n.businesses || []).forEach((b) => L.push('  ' + b.label + ' (' + b.role + ', ' + b.how + ')' + tag(b.live) + ': ' + b.why));
  const later = res.filter((r) => r.live === false);
  if (later.length) {
    L.push('', plan.status === 'planned' ? 'WHAT IT WOULD RUN ON [PLANNED]' : 'IF THE OWNER SWITCHES LOOT NEEDS ON [PLANNED — nothing here is charged today]');
    later.forEach((r) => L.push('  ' + r.name + ': ' + r.why + ' WHERE: ' + r.whereToFind));
  }
  if (n.notes && n.notes.length) n.notes.forEach((x) => L.push('  * ' + x.text));
  if (plan.steps && plan.steps.length) { L.push('', 'THE PLAN'); plan.steps.forEach((s) => L.push('  ' + s.n + '. ' + s.title + tag(s.live), '     ' + (s.detail || ''))); }
  if (plan.earn) { L.push('', 'WHAT IT EARNS (' + plan.earn.basis + ')', '  ' + plan.earn.text); (plan.earn.caveats || []).forEach((c) => L.push('  * ' + c)); }
  if (plan.risks && plan.risks.length) { L.push('', 'THE CATCHES'); plan.risks.forEach((r) => L.push('  ! ' + r.title + tag(r.live) + ': ' + r.detail)); }
  if (plan.effort) L.push('', 'EFFORT: ' + plan.effort + ' — ' + (plan.effortWhy || ''));
  return L.join('\n');
}

/* ── planFor — the contract export ────────────────────────────────────────── */
/* planFor(nodeId, { opEcon, held, owns, data, gems?, opLabel? })
     opEcon  the bridge's opEcon(id) function, a table keyed by op id (the
             fixture's .opsEcon), or this tile's single row. null = "unknown".
     held    (id) => number, or an {id: number} map. Optional.
     owns    (id) => boolean, an id array, a Set, or an {id: true} map. Optional.
     gems    the player's Cinder: a number or a thunk. Optional.
     opLabel the bridge's opLabel(id). Optional; the map's own label otherwise.
     data    { catalog, businesses, recipes, coverage, shipping, loot, graph,
               partners? } — module namespaces or bare tables.
   Always returns a plan. An id that is on no map gets a plan that says so.
   For a view: print needToStart.resources with `live !== false` first, the rest
   as a secondary "if the owner switches loot needs on" list, then
   needToStart.notes (caveats several rows share, each said once). planText()
   is the reference layout. */
export function planFor(nodeId, opts) {
  const o = isObj(opts) ? opts : {};
  const id = typeof nodeId === 'string' ? nodeId : '';
  try {
    if (own(PART, id)) return partPlan(id, o);
    const F = gather(id, o);
    if (!F.b && !own(NOTES, id)) return unknownPlan(id);
    if (F.planned) return plannedPlan(F, o);
    const earn = earnOf(F);
    const rn = resourceNeeds(F, o, earn);
    /* resources stays ONE array (the contract shape); each row's `live` splits it,
       and `notes` holds every caveat the rows share, said once. */
    /* Kept apart from F.suppliers on purpose: "the map hangs N suppliers on it"
       and the step-3 "coming in" line are about what the owner DREW. */
    F.derived = derivedSuppliers(F, rn);
    const need = { cinder: cinderNeed(F, o), aza: azaNeed(F), resources: rn.rows, notes: rn.notes, screenMore: rn.screenMore, businesses: businessNeeds(F) };
    const partner = firstPartner(F);
    const fit = fitOf(F, earn);
    const plan = {
      id, label: F.label, kind: 'business', status: 'live', tileKind: F.kind,
      headline: (F.note.day || serviceWords(F) || '') + (F.note.who ? ' Best for ' + F.note.who + '.' : ''),
      makes: makesWords(F), basis: PLAN_BASIS,
      fitFor: fit.fitFor, notFor: fit.notFor,
      needToStart: need,
      steps: stepsOf(F, need, earn, partner),
      earn, risks: risksOf(F, earn),
      effort: F.note.plays ? 'active' : 'passive',
      effortWhy: F.note.plays ? 'The hourly operation runs by itself, but what makes it worth owning is a screen you play: ' + F.note.door + '.' : 'Found it, staff it, keep it stocked, collect. ' + (F.note.door ? 'It also gives you ' + F.note.door + '.' : 'There is no screen to play.'),
      effortCite: F.note.cite || null,
      owned: ownsOf(o.owns, id), firstPartner: partner, customers: F.customers, suppliers: F.suppliers.concat(F.derived),
    };
    plan.summary = summaryOf(plan, F);
    plan.rule = { phase: F.rule.phase, known: F.rule.known, optional: F.rule.optional, sentence: F.rule.sentence };
    tidy(plan);
    plan.verdictFor = makeVerdict(plan, o);
    plan.text = planText(plan);
    return plan;
  } catch (e) {
    /* Total by contract: a thinner plan, never a throw into the modal. */
    const p = unknownPlan(id); p.error = String((e && e.message) || e); return p;
  }
}
function unknownPlan(id) {
  const plan = { id, label: id || 'Unknown', kind: 'unknown', status: 'unknown', headline: 'This is not a tile, system or channel on the owner\'s map, so there is no plan for it.', basis: PLAN_BASIS,
    fitFor: [], notFor: [], needToStart: { cinder: { amount: null, known: false, held: null, afford: UNKNOWN, text: 'Unknown.', live: false }, aza: { amount: null, known: false, text: 'Unknown.', live: false }, resources: [], businesses: [] },
    steps: [], earn: blankEarn(null, 'Unknown.'), risks: [], effort: 'passive', effortWhy: '' };
  plan.verdictFor = () => ({ verdict: 'maybe', label: 'Unknown', headline: 'No plan for this id.', reasons: [], afford: UNKNOWN, stock: UNKNOWN, firstAction: null });
  plan.text = planText(plan);
  return plan;
}

/* Every node a plan exists for, so the audit can loop without knowing the map. */
export function planIds(data) {
  return uniq(Object.keys(PART).concat(bizRows(data || {}).map((b) => b.id), Object.keys(NOTES)));
}

export default planFor;
