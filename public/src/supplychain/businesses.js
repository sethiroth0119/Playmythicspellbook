/* ════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · businesses.js — the owner's PDF map, as data. Nothing else.
   ────────────────────────────────────────────────────────────────────────
   Source: "Supply and Demand supply chain.pdf" (9 pages, rendered 1900x1068).
   Every coordinate below is a pixel position in that page frame, so any single
   icon can be re-checked against the page without trusting this file.

   WHY THIS FILE IS ONLY A TRANSCRIPTION
   The map is the owner's; the game is not yet the map. If this file "fixed"
   the drawing (added the trucks the goal asks for, picked a side on the p8
   card, turned Car Factory's Car Dealer icon into a supplier) every later
   piece would inherit a guess presented as the owner's word, and the owner
   could no longer tell which parts of the screen are theirs. So:
     - what is DRAWN lives in `drawn` (one entry per icon, with its pixel);
       `icons` and `needs` are DERIVED from `drawn` and can never drift from it;
     - what the written GOAL says lives beside it (`goalSaysTransport`), never
       merged into `icons.transport`;
     - every doubt is a row in AMBIGUITIES with BOTH readings, `resolved:false`.
   Rejected design: a hand-typed `icons` block per row next to a hand-typed
   `needs` list. Two copies of one fact; the first edit makes them disagree and
   the critic's "0 missing / 0 invented" count silently reads the wrong copy.

   WHAT IS DELIBERATELY NOT HERE
   No resource id (the PDF names none — ambiguity M; recipes.js owns that), no
   price, wage, rate or yield (opEcon() over the bridge owns those), no claim
   about what the shipped game enforces beyond `status` (does the op exist).

   PURE: no imports, no window, no DOM. `node -e "import('./businesses.js')"` works.
   ════════════════════════════════════════════════════════════════════════ */

/* Deep freeze because five other pieces read these rows at once; a view that
   sorted `needs` in place would reorder the owner's drawn order for everyone. */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const PDF = deepFreeze({
  file: 'Supply and Demand supply chain.pdf',
  pages: 9,
  frame: [1900, 1068],
  /* Each pN.txt is ONE line, so a text cite is always line 1. */
  txtCite: 'p<page>.txt:1',
  title: 'Supply and Demand with businesses',              // p6-p9
  titleAt: [882, 70],
  /* Verbatim, including the doubled word. This sentence is the whole semantics
     of the small business icons, so it is kept exactly as printed. */
  iconRule: 'The icons next to the business types needs the other business business to earn in the ecosystem.',
  iconRuleAt: [1605, 73],
});

/* ── Legend (top-left of p6, p7, p8 AND p9 — identical each time) ───────── */
export const LEGEND = deepFreeze([
  { key: 'market',    node: 'ch:market',    text: 'Marketplace: Best to make money',     art: 'shop inside a cycle of four arrows and nodes', at: [57, 42],  textAt: [222, 42],  meaning: 'sells on / earns through the Marketplace' },
  { key: 'transport', node: 'transport',    text: 'Transport: Best to make money',       art: 'orange semi truck with a white box trailer',   at: [62, 138], textAt: [222, 138], meaning: 'needs the Transport company' },
  { key: 'carMarket', node: 'ch:carmarket', text: 'Car Marketplace: Best to make money', art: 'yellow tow truck carrying an orange car',      at: [62, 225], textAt: [222, 226], meaning: 'tied to the Car Marketplace' },
  { key: 'card',      node: 'sys:battle',   text: 'Good For Battlers and camp training', art: 'gold-framed dark-mage card (the Battle System art from p1)', at: [57, 325], textAt: [199, 319], meaning: 'output is useful to battlers / camp training' },
].map(r => ({ ...r, pages: [6, 7, 8, 9], pdfCite: { page: 6, txt: 'p6.txt:1', jpg: 'p6.jpg', at: r.at } })));

/* ── The 4 systems (p1 overview; p2-p5 one page each) ───────────────────── */
/* Blurbs are taken from the single-system pages (p2-p5): the p1 text layer is
   the same words but carries line-wrap artefacts ("well-  designed"). */
export const SYSTEMS = deepFreeze([
  {
    id: 'sys:battle', label: 'Battle System', pdfLabel: 'Battle System', page: 2, order: 0,
    blurb: 'Gather exclusive resources used for crafting in Just Business operations. These resources generate revenue for both the skill and the players who discover them.',
    bestBuyers: 'Business Players', bestBuyersNodes: ['sys:business'],
    art: 'gold-framed card of a dark mage with four elemental orbs',
    ambiguities: ['I'],
    pdfCite: { page: 2, txt: 'p2.txt:1', jpg: 'p2.jpg', bestBuyersAt: [1430, 810], overview: { page: 1, txt: 'p1.txt:1', headingAt: [243, 367], artAt: [243, 190] } },
  },
  {
    id: 'sys:business', label: 'Just Business', pdfLabel: 'Just Business', page: 3, order: 1,
    blurb: 'A place where essential city resources and items are crafted. For example, a car dealership purchases vehicles from a car factory and sells them to players for battles and delivery missions, creating revenue streams for every business involved.',
    bestBuyers: 'City Builders', bestBuyersNodes: ['sys:city'],
    art: 'isometric ruined hospital (EMERGENCY / HOSPITAL / SCP, helipad)',
    ambiguities: [],
    pdfCite: { page: 3, txt: 'p3.txt:1', jpg: 'p3.jpg', bestBuyersAt: [1406, 907], overview: { page: 1, txt: 'p1.txt:1', headingAt: [762, 534], artAt: [762, 405] } },
  },
  {
    id: 'sys:city', label: 'City Builder', pdfLabel: 'City Builder', page: 4, order: 2,
    blurb: 'Players build and develop their cities around the resources and utilities they provide to the player-driven market and ecosystem. A well-designed city produces essential supplies for player camps and Just Business operations while generating passive Cinder income for its owner.',
    bestBuyers: 'Trainers/Battlers', bestBuyersNodes: ['sys:camp', 'sys:battle'],
    art: 'flat-colour skyline with a blue spire',
    ambiguities: [],
    pdfCite: { page: 4, txt: 'p4.txt:1', jpg: 'p4.jpg', bestBuyersAt: [1364, 775], overview: { page: 1, txt: 'p1.txt:1', headingAt: [1305, 603], artAt: [1310, 465] } },
  },
  {
    id: 'sys:camp', label: 'Camp', pdfLabel: 'Camp', page: 5, order: 3,
    blurb: 'Where players make it better for their units and level up their units to make them stronger in battle, this helps players be able to increase the value of their units and help them build decks to be able to survive battles to bring back resources as well send units on missions to bring back resources.',
    bestBuyers: 'Business owners', bestBuyersNodes: ['sys:business'],
    art: 'olive A-frame tent',
    ambiguities: ['J'],
    pdfCite: { page: 5, txt: 'p5.txt:1', jpg: 'p5.jpg', bestBuyersAt: [1433, 950], overview: { page: 1, txt: 'p1.txt:1', headingAt: [1665, 593], artAt: [1665, 450] } },
  },
]);

/* ── p1 arrows ──────────────────────────────────────────────────────────── */
/* Above EACH drawn arrow sits the same trio: the words "Market Place
   Resources", the Marketplace icon and a Cinder flame. What is drawn is [sure];
   "every hand-off is paid in Cinder through the Marketplace" is a reading of
   it, so it is carried as `reading`, not as a fact. */
const TRIO = (labelAt, marketAt, cinderAt) => ({
  label: 'Market Place Resources', labelAt,
  channel: 'ch:market', channelAt: marketAt,
  currency: 'cinder', currencyAt: cinderAt,
  reading: 'every hand-off between systems goes through the Marketplace and is paid in Cinder',
  readingConfidence: 'likely',
});
export const SYSTEM_FLOW = deepFreeze([
  { id: 'flow:battle-business', from: 'sys:battle',   to: 'sys:business', drawn: true,  impliedByText: false, confidence: 'sure',
    arrowAt: [[395, 390], [605, 497]],   carries: TRIO([527, 232], [502, 345], [580, 325]),
    pdfCite: { page: 1, txt: 'p1.txt:1', jpg: 'p1.jpg', at: [500, 445] } },
  { id: 'flow:business-city',   from: 'sys:business', to: 'sys:city',     drawn: true,  impliedByText: false, confidence: 'sure',
    arrowAt: [[945, 542], [1180, 548]],  carries: TRIO([1038, 338], [1041, 461], [1131, 422]),
    pdfCite: { page: 1, txt: 'p1.txt:1', jpg: 'p1.jpg', at: [1062, 545] } },
  { id: 'flow:city-camp',       from: 'sys:city',     to: 'sys:camp',     drawn: true,  impliedByText: false, confidence: 'sure',
    arrowAt: [[1450, 597], [1585, 600]], carries: TRIO([1475, 353], [1493, 496], [1547, 425]),
    pdfCite: { page: 1, txt: 'p1.txt:1', jpg: 'p1.jpg', at: [1517, 598] } },
  /* NOT an arrow on the page. The loop closes only in the Camp prose. Kept in
     this list (flagged) because a 3D loop with a missing fourth side reads as a
     bug, while an unflagged fourth arrow would be an invented one. */
  { id: 'flow:camp-battle',     from: 'sys:camp',     to: 'sys:battle',   drawn: false, impliedByText: true,  confidence: 'likely',
    arrowAt: null, carries: null, ambiguity: 'J',
    basis: 'help them build decks to be able to survive battles to bring back resources as well send units on missions to bring back resources',
    pdfCite: { page: 1, txt: 'p1.txt:1', jpg: 'p1.jpg', at: null, also: 'p5.txt:1' } },
]);

/* Flows the PROSE asserts and nobody drew. Separate from SYSTEM_FLOW so a view
   can never mistake them for the owner's arrows. */
export const TEXT_FLOWS = deepFreeze([
  { id: 'text:city-business',   from: 'sys:city',   to: 'sys:business', basis: 'A well-designed city produces essential supplies for player camps and Just Business operations', pdfCite: { page: 4, txt: 'p4.txt:1' } },
  { id: 'text:camp-missions',   from: 'sys:camp',   to: 'sys:camp',     basis: 'send units on missions to bring back resources (a second resource source beside battle)', pdfCite: { page: 5, txt: 'p5.txt:1' } },
  { id: 'text:carfactory-cars', from: 'carfactory', to: 'cars',         basis: 'a car dealership purchases vehicles from a car factory and sells them to players for battles and delivery missions', pdfCite: { page: 3, txt: 'p3.txt:1' } },
  /* Best Buyers p2-p5 form a cycle; Camp output goes back to BUSINESSES. */
  { id: 'buyers:battle',   from: 'sys:battle',   to: 'sys:business', basis: 'Best Buyers: Business Players',  pdfCite: { page: 2, txt: 'p2.txt:1', at: [1430, 810] } },
  { id: 'buyers:business', from: 'sys:business', to: 'sys:city',     basis: 'Best Buyers: City Builders',     pdfCite: { page: 3, txt: 'p3.txt:1', at: [1406, 907] } },
  { id: 'buyers:city',     from: 'sys:city',     to: 'sys:camp',     basis: 'Best Buyers: Trainers/Battlers', alsoTo: 'sys:battle', pdfCite: { page: 4, txt: 'p4.txt:1', at: [1364, 775] } },
  { id: 'buyers:camp',     from: 'sys:camp',     to: 'sys:business', basis: 'Best Buyers: Business owners',   pdfCite: { page: 5, txt: 'p5.txt:1', at: [1433, 950] } },
]);

/* ── The 2 channels. Legend icons only — neither is drawn as a tile. ────── */
export const CHANNELS = deepFreeze([
  { id: 'ch:market',    label: 'Marketplace',     pdfLabel: 'Marketplace', legend: 'Marketplace: Best to make money',
    iconKey: 'market', art: 'shop inside a cycle of four arrows and nodes', drawnAsTile: false,
    alsoPrintedAs: 'Market Place', ambiguities: ['H'],
    pdfCite: { page: 6, pages: [1, 6, 7, 8, 9], txt: 'p6.txt:1', jpg: 'p6.jpg', at: [57, 42] } },
  { id: 'ch:carmarket', label: 'Car Marketplace', pdfLabel: 'Car Marketplace', legend: 'Car Marketplace: Best to make money',
    iconKey: 'carMarket', art: 'yellow tow truck carrying an orange car', drawnAsTile: false,
    alsoPrintedAs: null, ambiguities: ['D'],
    pdfCite: { page: 6, pages: [6, 7, 8, 9], txt: 'p6.txt:1', jpg: 'p6.jpg', at: [62, 225] } },
]);

/* ── p9 rule (verbatim) ─────────────────────────────────────────────────── */
export const P9_RULE = deepFreeze({
  verbatim: 'These companies work only for the city and allows npcs to do business with other cities and camps. This is how players will be able to hire from camps they are registered to the city has to have a Bus, Airport or train station.',
  at: [841, 800],
  parsed: {
    scope: 'sys:city',                 // "work only for the city" — not a Just Business shipper, never a stand-in for Transport
    npcTradeWith: ['sys:city', 'sys:camp'],
    hiringFromCampsRequiresAnyOf: ['bus', 'airport', 'rail'],   // printed "Bus, Airport or train station" — OR, not AND
    trainStationIs: 'rail',
  },
  /* The map states it; this file does not claim the game enforces it. */
  enforcement: 'planned',
  ownerDecision: 'D5',
  pdfCite: { page: 9, txt: 'p9.txt:1', jpg: 'p9.jpg', at: [841, 800] },
});

/* ── Tile DSL ───────────────────────────────────────────────────────────── */
/* One call per DRAWN icon, in the owner's top-to-bottom order. `c` is how sure
   we are the icon BELONGS to this tile (crowded p7/p8 rely on column x-alignment,
   ambiguity L) — not how sure we are about what it means. */
const T    = (x, y, c = 'sure', o = {}) => ({ icon: 'transport', at: [x, y], confidence: c, ...o });
const M    = (x, y, c = 'sure', o = {}) => ({ icon: 'market',    at: [x, y], confidence: c, ...o });
const CM   = (x, y, c = 'sure', o = {}) => ({ icon: 'carMarket', at: [x, y], confidence: c, ...o });
const CARD = (x, y, c = 'sure', o = {}) => ({ icon: 'card',      at: [x, y], confidence: c, ...o });
/* A small business icon: "this tile needs that business in order to earn".
   direction defaults to 'supplier'; the map mixes supplier and buyer readings
   (ambiguity C), so the exceptions are spelled out per icon. */
const B    = (biz, x, y, c = 'sure', o = {}) => ({ icon: 'biz', biz, at: [x, y], confidence: c, direction: 'supplier', ...o });

const RANK = { sure: 0, likely: 1, ambiguous: 2 };
const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

function tile(r) {
  const drawn = r.drawn || [];
  const flag = key => {
    const hits = drawn.filter(d => d.icon === key);
    if (!hits.length) return false;
    /* '?' (truthy on purpose) = an icon is on the page but may belong to the
       neighbouring tile. A view that only tests truthiness still draws it; a
       view that cares compares with '?' or reads `iconDoubt`. */
    return hits.every(d => d.confidence === 'ambiguous') ? '?' : true;
  };
  const icons = { transport: flag('transport'), market: flag('market'), carMarket: flag('carMarket'), card: flag('card') };
  const needs = drawn.filter(d => d.icon === 'biz').map(d => ({
    biz: d.biz,
    direction: d.direction,
    /* One contract field, so it carries the weaker of "is this icon ours" and
       "which way does the need point". The two halves stay available. */
    confidence: worst(d.confidence, d.directionConfidence || 'sure'),
    attribution: d.confidence,
    directionConfidence: d.directionConfidence || 'sure',
    at: d.at,
    ...(d.readings ? { readings: d.readings } : {}),
    ...(d.ambiguity ? { ambiguity: d.ambiguity } : {}),
    ...(d.note ? { note: d.note } : {}),
  }));
  const page = r.page;
  const kind = r.kind || 'producer';
  const status = r.status || 'live';
  return {
    id: r.id,
    opId: status === 'planned' ? null : r.id,             // canonical ids ARE the OPS_ECON ids (contract)
    label: r.label,
    pdfLabel: r.pdfLabel || r.label,                      // exactly as printed
    page,
    pages: r.pages || [page],
    status,
    statusCite: r.statusCite || `OPS_ECON.${r.id} (public/index.html); the in-game name comes from opLabel('${r.id}') over the bridge, never from this file`,
    system: kind === 'cityTransit' ? 'sys:city' : 'sys:business',
    kind,
    icons,
    iconDoubt: Object.keys(icons).filter(k => icons[k] === '?'),
    needs,
    drawn,
    /* The written goal ("every business has to use the transport company to
       ship to other players business") versus the drawing. Kept APART from
       icons.transport — ambiguity B. */
    goalSaysTransport: !!r.goalSaysTransport,
    transportNote: r.transportNote || null,
    caption: r.caption || null,
    captionAt: r.captionAt || null,
    cityOnly: kind === 'cityTransit',
    rule: kind === 'cityTransit' ? 'P9_RULE' : null,
    art: r.art,
    ambiguities: r.ambiguities || [],
    pdfCite: { page, txt: `p${page}.txt:1`, jpg: `p${page}.jpg`, headingAt: r.headingAt, artAt: r.artAt, crops: r.crops || [] },
  };
}

/* ── THE 27 TILES ───────────────────────────────────────────────────────── */
/* kind: the contract has four. The 21 icon-bearing tiles are all 'producer'
   because that is how the PDF groups them (Dojo and Card Shop sell a service,
   but the owner drew them in the same grid with the same icon grammar). */
export const BUSINESSES = deepFreeze([
  /* Hub — drawn top-centre on p6, p7 AND p8, identical each time. Its two icons
     sit to the LEFT of the truck. No Marketplace, no tow truck, no card. */
  tile({ id: 'transport', label: 'Transport', page: 6, pages: [6, 7, 8], kind: 'hub',
    headingAt: [840, 155], artAt: [915, 270], crops: ['p6t.jpg'],
    art: 'big orange semi truck with a white box trailer',
    goalSaysTransport: false, transportNote: 'it IS the carrier; the goal routes every other business through it',
    ambiguities: ['C'],
    drawn: [
      B('gas',  730, 258),
      B('cars', 732, 338, 'sure', { directionConfidence: 'likely', ambiguity: 'C', note: 'vehicles for the fleet is the natural reading; the same icon is a BUYER on Car Factory, so direction is not certain here' }),
    ] }),

  /* ── p6 ── */
  tile({ id: 'mining', label: 'Mining Company', page: 6, headingAt: [217, 449], artAt: [250, 560], crops: ['p6a.jpg'],
    art: 'grey rock and pickaxe', goalSaysTransport: true,
    drawn: [T(403, 503), M(403, 578)] }),
  tile({ id: 'oil', label: 'Oil Company', page: 6, headingAt: [685, 435], artAt: [740, 550], crops: ['p6a.jpg'],
    art: 'red pumpjack', goalSaysTransport: true,
    drawn: [T(595, 500), M(595, 578), CM(598, 668), B('mining', 608, 730)] }),
  tile({ id: 'gas', label: 'Gas Station', page: 6, headingAt: [1039, 435], artAt: [1065, 555], crops: ['p6a.jpg'],
    art: 'red GAS building with a pump', goalSaysTransport: true,
    drawn: [T(912, 512), M(912, 590), CM(915, 682), B('oil', 912, 755)] }),
  tile({ id: 'cars', label: 'Car Dealer', page: 6, headingAt: [1396, 436], artAt: [1395, 560], crops: ['p6a.jpg'],
    art: 'two men and an orange sports car', goalSaysTransport: true,
    transportNote: 'no truck drawn (its icons sit RIGHT of the art: tow truck, Marketplace, Gas Station); may move stock through the Car Marketplace instead',
    ambiguities: ['B', 'C'],
    drawn: [CM(1575, 493), M(1575, 578), B('gas', 1582, 680)] }),
  tile({ id: 'construction', label: 'Construction Company', page: 6, headingAt: [208, 1003], artAt: [210, 890], crops: ['p6b.jpg'],
    art: 'crane, brick wall and cement mixer', goalSaysTransport: true,
    drawn: [T(380, 838), B('trashcrusher', 388, 898), B('mining', 393, 955)] }),
  tile({ id: 'trashcrusher', label: 'Trash Crusher', page: 6, headingAt: [655, 1012], artAt: [655, 890], crops: ['p6b.jpg'],
    art: 'yellow tracked crusher with a conveyor', goalSaysTransport: true,
    drawn: [T(835, 845), M(835, 930), B('mining', 848, 1015)] }),
  tile({ id: 'weaponsmith', label: 'Weapon Smith', page: 6, headingAt: [1092, 1003], artAt: [1105, 880], crops: ['p6b.jpg'],
    art: 'pistol crossed with a purple sword', goalSaysTransport: true,
    transportNote: 'no truck drawn',
    ambiguities: ['B', 'L'],
    drawn: [
      /* Sits in the gap under Car Dealer but is x-aligned with this column. */
      CARD(1253, 752, 'likely', { ambiguity: 'L' }),
      B('mining', 1260, 848), M(1255, 938), B('trashcrusher', 1265, 1030),
    ] }),

  /* ── p7 ── */
  tile({ id: 'restaurant', label: 'Restaurant', page: 7, headingAt: [217, 449], artAt: [240, 555], crops: ['p7a.jpg'],
    art: 'burger, fries and a drink', goalSaysTransport: true,
    /* The Fishing icon sits ABOVE the heading line; same column. */
    drawn: [B('fishing', 403, 370), T(403, 455), M(403, 532), B('agri', 408, 635), B('feed', 410, 715)] }),
  tile({ id: 'agri', label: 'Agricultural Op.', page: 7, headingAt: [685, 435], artAt: [725, 560], crops: ['p7a.jpg'],
    art: 'brown soil plot with green shoots', goalSaysTransport: true, ambiguities: ['D', 'E'],
    drawn: [T(595, 500), M(595, 578), CM(598, 668, 'sure', { ambiguity: 'D' }), B('oil', 600, 745, 'sure', { ambiguity: 'E' })] }),
  tile({ id: 'feed', label: 'Home Feed', pdfLabel: 'Home  Feed', page: 7, headingAt: [1070, 433], artAt: [1070, 560], crops: ['p7a.jpg'],
    art: 'farmer feeding goats', goalSaysTransport: true, ambiguities: ['D', 'G'],
    drawn: [T(912, 512), M(912, 590), CM(915, 682, 'sure', { ambiguity: 'D' }), B('agri', 910, 755)] }),
  tile({ id: 'dojo', label: 'Dojo', page: 7, headingAt: [1396, 436], artAt: [1396, 590], crops: ['p7a.jpg'],
    art: 'TRAINING chalkboard on an easel', goalSaysTransport: true,
    transportNote: 'no truck and no Marketplace drawn; the card is its only icon; plausibly ships nothing physical',
    ambiguities: ['B'],
    drawn: [CARD(1530, 533)] }),
  tile({ id: 'cardshop', label: 'Card Shop', page: 7, headingAt: [208, 1003], artAt: [180, 880], crops: ['p7b.jpg'],
    art: 'storefront', goalSaysTransport: true,
    transportNote: 'no truck drawn; plausibly ships nothing physical',
    ambiguities: ['B'],
    drawn: [CARD(362, 843), M(362, 935)] }),
  tile({ id: 'fishing', label: 'Fishing Company', pdfLabel: 'Fishing company', page: 7, headingAt: [655, 1012], artAt: [650, 900], crops: ['p7b.jpg'],
    art: 'fishing rod and fish', goalSaysTransport: true,
    drawn: [T(835, 845), M(835, 922), B('gas', 842, 1015)] }),
  tile({ id: 'cannery', label: 'Fish Cannery', page: 7, headingAt: [1092, 1003], artAt: [1092, 880], crops: ['p7b.jpg'],
    art: 'fish can on a conveyor', goalSaysTransport: true, ambiguities: ['L'],
    drawn: [
      /* Vertically near Dojo's easel legs, x-aligned with the cannery column. */
      B('trashcrusher', 1285, 742, 'likely', { ambiguity: 'L' }),
      M(1283, 838), B('fishing', 1287, 928), T(1283, 1018),
    ] }),
  tile({ id: 'bank', label: 'Bank', page: 7, kind: 'service', headingAt: [1532, 1033], artAt: [1532, 940], crops: ['p7b.jpg'],
    art: 'columned BANK building', caption: 'Funds businesses and players', captionAt: [1705, 948],
    goalSaysTransport: false, transportNote: 'a lender ships nothing; no icons of any kind are drawn',
    ambiguities: ['K'], drawn: [] }),

  /* ── p8 ── */
  tile({ id: 'genelab', label: 'Genetics Lab', page: 8, headingAt: [217, 449], artAt: [215, 580], crops: ['p8a.jpg', 'p8b.jpg'],
    art: 'DNA helix, microscope and scientists', goalSaysTransport: true, ambiguities: ['A'],
    /* One column at x~405 with a steady ~85px rhythm; no Marketplace icon. */
    drawn: [
      B('research', 400, 290), T(403, 360), B('agri', 405, 445), B('feed', 405, 540), B('mining', 405, 620),
      CARD(405, 710, 'ambiguous', { ambiguity: 'A', sharedWith: 'carfactory' }),
    ] }),
  tile({ id: 'medical', label: 'Medical Corporation', page: 8, headingAt: [685, 435], artAt: [735, 555], crops: ['p8a.jpg'],
    art: 'clipboard with a blue cross', goalSaysTransport: true,
    /* The owner's own example lane: Fashion, then Transport, then Medical. */
    drawn: [T(595, 500), M(595, 590), B('research', 590, 675), B('fashion', 590, 750)] }),
  tile({ id: 'fashion', label: 'Fashion Brand', page: 8, status: 'planned',
    statusCite: 'no op in OPS_ECON; OWNER_DECISIONS D4: drawn by the owner, not in the shipped game',
    headingAt: [1075, 433], artAt: [1067, 540], crops: ['p8a.jpg'],
    art: 'mint-green hoodie', goalSaysTransport: true,
    drawn: [T(920, 490), M(920, 568)] }),
  tile({ id: 'research', label: 'Research Facility', page: 8, headingAt: [1396, 436], artAt: [1398, 535], crops: ['p8a.jpg'],
    art: 'blue atom with a red nucleus', goalSaysTransport: true,
    /* Genetics and Medical each show the atom back: two drawn cycles. */
    drawn: [B('genelab', 1590, 355), CARD(1588, 448), B('medical', 1595, 555), T(1608, 642), M(1600, 718)] }),
  tile({ id: 'carfactory', label: 'Car Factory', page: 8, headingAt: [147, 995], artAt: [160, 875], crops: ['p8b.jpg'],
    art: 'car on an orange lift with workers', goalSaysTransport: true,
    transportNote: 'no truck AND no tow truck drawn, although p3 says the dealership buys its vehicles here',
    ambiguities: ['A', 'B', 'C'],
    /* Two-column cluster right of the art. */
    drawn: [
      CARD(405, 710, 'ambiguous', { ambiguity: 'A', sharedWith: 'genelab' }),
      B('gas', 308, 745), M(310, 845), B('oil', 400, 840), B('trashcrusher', 320, 940), B('mining', 405, 935),
      /* By the page rule the factory "needs Car Dealer to earn"; p3's prose
         makes the dealer its CUSTOMER. So this icon is a buyer, not a supplier. */
      B('cars', 310, 1018, 'sure', { direction: 'buyer', directionConfidence: 'likely', ambiguity: 'C',
        readings: ['buyer: the dealership purchases the factory\'s cars (p3 prose)', 'supplier: as the icon rule literally reads'] }),
    ] }),
  tile({ id: 'smuggling', label: 'Smuggling Network', page: 8, headingAt: [655, 1012], artAt: [670, 900], crops: ['p8b.jpg'],
    art: 'cargo ship, customs officer and a red exclamation mark', goalSaysTransport: true, ambiguities: ['L'],
    drawn: [
      /* Could be read as Medical overflow, but Medical already has its own atom at (590,675). */
      B('research', 833, 690, 'likely', { ambiguity: 'L' }),
      /* Sits LEFT of the column, between Medical's hoodie and this truck. */
      B('fishing', 757, 765, 'likely', { ambiguity: 'L' }),
      T(843, 762), M(843, 845), B('gas', 843, 940), B('agri', 843, 1018),
    ] }),
  tile({ id: 'salvage', label: 'Salvage Operation', page: 8, headingAt: [1092, 1003], artAt: [1115, 840], crops: ['p8b.jpg'],
    art: 'two people in green surgical scrubs and masks', goalSaysTransport: true, ambiguities: ['C', 'F', 'L'],
    drawn: [
      /* Floats between Fashion Brand and Salvage; x-aligned with this column. */
      B('cars', 1297, 670, 'likely', { direction: 'ambiguous', directionConfidence: 'ambiguous', ambiguity: 'C',
        readings: ['supplier: the dealer hands over wrecks / trade-ins to strip', 'buyer: the dealer buys salvaged parts and vehicles'] }),
      /* Read as needs-as-BUYER (graph round 3). recipes.js rejected the supplier reading with a
         written reason: nothing the crusher makes is something a salvage yard consumes, so the
         yard needs the crusher to BUY its hulks. Left as 'supplier / sure' this row made the two
         truth files disagree about the owner's map in silence (graph.js direction-drift). It is
         the same open question as the Car Factory / Car Dealer icon, so it rides ambiguity C. */
      B('trashcrusher', 1300, 745, 'sure', { direction: 'buyer', directionConfidence: 'likely', ambiguity: 'C',
        readings: ['supplier: the crusher sells recycled stock to the yard', 'buyer: the crusher buys the stripped hulks and loose scrap'] }),
      M(1300, 843), B('research', 1300, 940), T(1300, 1018),
    ] }),
  tile({ id: 'warehouse', label: 'Warehouse', page: 8, kind: 'service', headingAt: [1560, 1008], artAt: [1570, 910], crops: ['p8b.jpg'],
    art: 'blue WAREHOUSE with an orange van', caption: 'Holds the storage of other players', captionAt: [1783, 890],
    goalSaysTransport: false, transportNote: 'third-party storage; no icons of any kind are drawn',
    ambiguities: ['K'], drawn: [] }),

  /* ── p9 — city-only transit. The legend is printed; no tile uses it. ── */
  tile({ id: 'bus', label: 'Bus Company', page: 9, kind: 'cityTransit', headingAt: [531, 434], artAt: [530, 580],
    art: 'blue and white minibus', goalSaysTransport: false, transportNote: 'works only for the city (P9_RULE); never a stand-in for Transport', drawn: [] }),
  tile({ id: 'rail', label: 'Rail Road', page: 9, kind: 'cityTransit', headingAt: [1040, 448], artAt: [1055, 565],
    art: 'blue and cream train on a track', goalSaysTransport: false, transportNote: 'works only for the city (P9_RULE); printed as two words; the rule text calls it "train station"', drawn: [] }),
  tile({ id: 'airport', label: 'Airport', page: 9, kind: 'cityTransit', status: 'planned',
    statusCite: 'no op in OPS_ECON; OWNER_DECISIONS D5: drawn by the owner, not in the shipped game',
    headingAt: [1628, 438], artAt: [1600, 565],
    art: 'white and navy jet', goalSaysTransport: false, transportNote: 'works only for the city (P9_RULE)', drawn: [] }),
]);

/* ── Ambiguities A-M. None is resolved here; `shownAs` is what the map does
      MEANWHILE, and is a display default, not a ruling. ─────────────────── */
export const AMBIGUITIES = deepFreeze([
  { id: 'A', title: 'p8 battler card at (405,710): Genetics Lab or Car Factory?', page: 8, at: [405, 710], affects: ['genelab', 'carfactory'],
    readings: [
      'Genetics Lab: it continues that tile\'s x~405 column and its ~85px rhythm (290/360/445/540/620/710); genetics feeds unit training',
      'Car Factory: it is level with the factory\'s Gas Station icon (308,745) and tops the right-hand column of its two-column cluster (card/oil/mining); p3 says cars are sold "to players for battles"',
    ],
    shownAs: 'on BOTH tiles with icons.card = "?"', ownerDecision: 'D6', resolved: false },
  { id: 'B', title: 'Written goal vs drawn map on Transport', page: 6, at: null, affects: ['cars', 'weaponsmith', 'dojo', 'cardshop', 'carfactory'],
    readings: [
      'as drawn: these five do not need the Transport company (Dojo / Card Shop ship nothing physical; Car Dealer may use the Car Marketplace)',
      'as written in the goal: every business ships through Transport and the five missing trucks are omissions',
    ],
    shownAs: 'icons.transport = false with goalSaysTransport = true; a view draws the truck marked "per your goal, not drawn on the PDF"', ownerDecision: 'D6', resolved: false },
  { id: 'C', title: 'Direction of "needs": supplier or customer?', page: 8, at: [310, 1018], affects: ['carfactory', 'cars', 'salvage', 'transport'],
    readings: [
      'needs-as-supplier: the icon is where the tile buys its inputs (true for most rows)',
      'needs-as-customer: the icon is who the tile must sell to in order to earn (Car Factory shows Car Dealer; Car Dealer shows NO Car Factory although p3 says it buys there)',
    ],
    shownAs: 'per-need `direction`: carfactory needs cars = buyer, salvage needs trashcrusher = buyer (likely), salvage needs cars = ambiguous, everything else supplier', ownerDecision: 'D6', resolved: false },
  { id: 'D', title: 'Car Marketplace tow truck beside Agricultural Op. and Home Feed', page: 7, at: [598, 668], affects: ['agri', 'feed'],
    readings: [
      'intended: farm businesses trade on the Car Marketplace (tractors, farm vehicles)',
      'copy-paste leftover: the p7 Agri / Home Feed icon columns sit at the exact coordinates of p6\'s Oil / Gas columns',
    ],
    shownAs: 'as drawn (icons.carMarket = true)', ownerDecision: 'D6', resolved: false },
  { id: 'E', title: 'Agricultural Op. needs Oil Company', page: 7, at: [600, 745], affects: ['agri'],
    readings: ['intended: fuel and fertiliser for the farm', 'copy-paste leftover from p6\'s Oil column (same caveat as D)'],
    shownAs: 'as drawn (supplier, likely intentional)', ownerDecision: 'D6', resolved: false },
  { id: 'F', title: 'Salvage Operation artwork is two surgeons in scrubs', page: 8, at: [1115, 840], affects: ['salvage'],
    readings: ['the LABEL is right and the art is a placeholder: a salvage yard', 'the ART is right and the tile is a medical / organ-salvage business'],
    shownAs: 'label kept ("Salvage Operation"); never renamed', ownerDecision: null, resolved: false },
  { id: 'G', title: '"Home  Feed" is printed with a wide gap (three spaces in the p7 text layer); which business is it?', page: 7, at: [1070, 433], affects: ['feed'],
    readings: ['livestock / animal feed (the art is a farmer feeding goats) = op `feed`, Feed Operation / Homestead Farm', 'a home-delivery food business ("Home Feed")'],
    shownAs: 'id `feed` per the lead contract', ownerDecision: null, resolved: false },
  { id: 'H', title: '"Market Place" (p1) vs "Marketplace" (p6-p9)', page: 1, at: [527, 232], affects: ['ch:market'],
    readings: ['the same channel, spelt two ways', 'p1 means a general marketplace OF resources, p6-p9 mean the specific Marketplace screen'],
    shownAs: 'one channel, ch:market', ownerDecision: null, resolved: false },
  { id: 'I', title: 'p1 "revenue for both the skill and the players who discover them"', page: 1, at: [243, 582], affects: ['sys:battle'],
    readings: ['"skill" = the battle skill / activity that finds the resource earns a share', '"skill" is a slip for another word (game, seller, guild)'],
    shownAs: 'transcribed verbatim, never paraphrased', ownerDecision: null, resolved: false },
  { id: 'J', title: 'No Camp to Battle System arrow is drawn', page: 1, at: null, affects: ['sys:camp', 'sys:battle'],
    readings: ['the chain is a line: Battle, Business, City, Camp, and it ends at Camp', 'the chain is a loop: the Camp prose closes it (units survive battles "to bring back resources")'],
    shownAs: 'fourth SYSTEM_FLOW row with drawn:false, impliedByText:true', ownerDecision: null, resolved: false },
  { id: 'K', title: 'Bank and Warehouse have no icons: how do they earn?', page: 7, at: [1705, 948], affects: ['bank', 'warehouse'],
    readings: ['pure services outside the goods chain: no Transport, no Marketplace, paid by fees / interest / rent', 'the icons were simply not drawn yet and they belong in the chain like everyone else'],
    shownAs: 'kind "service", captions verbatim, no icons. Builder note: economy/bank.js is simulated firm credit and must never be joined with player_banks', ownerDecision: null, resolved: false },
  { id: 'L', title: 'Icon attribution on crowded p6 / p7 / p8 relies on column x-alignment', page: 8, at: [833, 690], affects: ['smuggling', 'salvage', 'cannery', 'weaponsmith'],
    readings: [
      'by column: Smuggling owns the atom (833,690) and the fishing rod (757,765); Salvage owns the Car Dealer (1297,670); Fish Cannery owns the Crusher (1285,742); Weapon Smith owns the card (1253,752)',
      'by nearest art: the atom / rod are Medical Corporation overflow, the Car Dealer belongs to Fashion Brand, the Crusher to Dojo, the card to Car Dealer',
    ],
    shownAs: 'by column, each such icon marked confidence "likely"', ownerDecision: null, resolved: false },
  { id: 'M', title: 'No resource is named anywhere in the PDF', page: 6, at: null, affects: ['*'],
    readings: ['the owner leaves the cargo on every edge to the build (constraint from p1: it must originate in battle loot)', 'the owner has specific cargo in mind that the map does not show (the goal gives one: fashion makes cloth for medical)'],
    shownAs: 'this file names no resource; recipes.js decides and tags each choice', ownerDecision: 'D2', resolved: false },
]);

/* ── Lookups and derived views ──────────────────────────────────────────── */
const _byId = new Map(BUSINESSES.map(b => [b.id, b]));
export function bizById(id) { return _byId.get(id) || null; }
export function systemById(id) { return SYSTEMS.find(s => s.id === id) || null; }
export function channelById(id) { return CHANNELS.find(c => c.id === id) || null; }
export function ambiguityById(id) { return AMBIGUITIES.find(a => a.id === id) || null; }

/* Shipments as drawn: every "X needs Y" turned round to Y then X, EXCEPT where
   the need is a buyer (then X ships to Y). Ambiguous directions are emitted once,
   supplier-wise, with direction 'ambiguous' so a view can draw them dashed. */
export function edgesAsDrawn() {
  const out = [];
  for (const b of BUSINESSES) for (const n of b.needs) {
    const buyer = n.direction === 'buyer';
    out.push({ from: buyer ? b.id : n.biz, to: buyer ? n.biz : b.id, drawnOn: b.id, direction: n.direction,
      confidence: n.confidence, page: b.page, at: n.at });
  }
  return out;
}

/* Pairs drawn both ways (Research and Genetics, Research and Medical). */
export function mutualNeeds() {
  const out = [];
  for (const b of BUSINESSES) for (const n of b.needs) {
    const other = bizById(n.biz);
    if (other && b.id < other.id && other.needs.some(m => m.biz === b.id)) out.push([b.id, other.id]);
  }
  return out;
}

export function iconTally() {
  const names = k => BUSINESSES.filter(b => b.icons[k] === true).map(b => b.id);
  return {
    tiles: BUSINESSES.length,
    iconBearing: BUSINESSES.filter(b => b.drawn.length).map(b => b.id),
    transport: names('transport'), market: names('market'), carMarket: names('carMarket'), card: names('card'),
    cardAmbiguous: BUSINESSES.filter(b => b.icons.card === '?').map(b => b.id),
    noTruckButGoalSays: BUSINESSES.filter(b => !b.icons.transport && b.goalSaysTransport).map(b => b.id),
    neverNeeded: BUSINESSES.filter(b => !BUSINESSES.some(o => o.needs.some(n => n.biz === b.id && n.direction !== 'buyer'))).map(b => b.id),
  };
}

/* Self-check the graph piece can fold into its report. Structural only: it
   cannot know whether a pixel is right — that is the critic's job. */
export function validate() {
  const errors = [];
  const CANON = ['mining', 'oil', 'gas', 'cars', 'construction', 'trashcrusher', 'weaponsmith', 'restaurant', 'agri', 'feed', 'dojo',
    'cardshop', 'fishing', 'cannery', 'bank', 'genelab', 'medical', 'research', 'carfactory', 'smuggling', 'salvage', 'warehouse',
    'transport', 'bus', 'rail', 'fashion', 'airport'];
  const ids = BUSINESSES.map(b => b.id);
  if (ids.length !== new Set(ids).size) errors.push('duplicate business id');
  for (const c of CANON) if (!_byId.has(c)) errors.push(`missing canonical id ${c}`);
  for (const i of ids) if (!CANON.includes(i)) errors.push(`non-canonical id ${i}`);
  if (SYSTEMS.length !== 4) errors.push('systems != 4');
  if (CHANNELS.length !== 2) errors.push('channels != 2');
  if (SYSTEM_FLOW.filter(f => f.drawn).length !== 3) errors.push('drawn system arrows != 3');
  for (const b of BUSINESSES) {
    for (const n of b.needs) {
      if (!_byId.has(n.biz)) errors.push(`${b.id} needs unknown ${n.biz}`);
      if (n.biz === b.id) errors.push(`${b.id} needs itself`);
    }
    for (const a of b.ambiguities) if (!ambiguityById(a)) errors.push(`${b.id} cites unknown ambiguity ${a}`);
    for (const d of b.drawn) if (d.ambiguity && !b.ambiguities.includes(d.ambiguity)) errors.push(`${b.id} icon cites ${d.ambiguity} but the row does not`);
    if (!b.pdfCite.headingAt) errors.push(`${b.id} has no heading pixel`);
    if ((b.status === 'planned') !== (b.opId === null)) errors.push(`${b.id} status/opId disagree`);
  }
  for (const a of AMBIGUITIES) {
    if (a.readings.length !== 2) errors.push(`ambiguity ${a.id} must carry exactly two readings`);
    if (a.resolved) errors.push(`ambiguity ${a.id} is marked resolved; only the owner resolves`);
    for (const x of a.affects) if (x !== '*' && !_byId.has(x) && !systemById(x) && !channelById(x)) errors.push(`ambiguity ${a.id} affects unknown ${x}`);
  }
  if (AMBIGUITIES.map(a => a.id).join('') !== 'ABCDEFGHIJKLM') errors.push('ambiguities are not exactly A-M');
  return errors;
}
