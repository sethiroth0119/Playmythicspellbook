/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · hover.js — the owner's "hovering over a business shows a modal".

   Two exports, split on purpose so the FACTS can be tested in Node and the
   CARD can be tested in a browser, and neither has to know the other exists:

     hoverVM(id, data)   PURE. Turns one graph node into the words, icons and
                         badges the card shows. No DOM, no window, no bridge:
                         `node` can import() this file and call it. Every name
                         and icon comes from the catalogue rows in `data`, every
                         badge from the PDF transcription (businesses.js via the
                         graph) — nothing is retyped here, and no economy number
                         is on the card at all (the modal reads those live).
     mountHover(root)    ONE parchment card, absolutely positioned inside the
                         overlay, pointer-events:none, moved with a transform.
                         show(vm, xy) renders + places it in the SAME task;
                         hide() hides it; dispose() leaves nothing behind.

   WHY A VIEW-MODEL AND NOT "render the node". The scene, the 2D fallback and
   the search box all hover the same 33 nodes; if each built its own strings the
   Fashion Brand would say PLANNED in one and not another. hoverVM is the one
   place the card's words are decided, and the critic can diff its output for
   all 33 ids without a browser.

   PLACEMENT RULES (the bar):
     - never off-screen at any of the four corners, at 1366x768 or 390x844;
     - never on top of the hovered node (xy may carry the node's screen rect)
       and never under the pointer itself;
     - flips right/left and below/above before it clamps, so the card sits
       BESIDE the node like a paper tag, not smeared over it.
   Rejected: `position:fixed` + left/top. Every move would restyle layout;
   translate3d only touches the compositor, which matters when the pointer
   sweeps thirty tiles a second across the 3D map.
   Rejected: fading in. The bar says "appears in the same task as show()" and
   a 120 ms opacity ramp makes a synchronous "is it visible?" read lie. The
   shell owns the show/hide delays (SC.hover.showDelayMs / hideDelayMs); the
   card itself is instant.

   PALETTE: DESIGN-BAR section 1 reserves parchment (#d9cbaa on #241f16) for
   tooltips and explainers, so this is the one Supply Chain surface drawn on
   parchment. The LIVE chip is gold and PLANNED is ember: the bar's green and
   teal both fail its own blue-channel test (b - r > 8), so they are not used.
   Colours are CSS variables with the SC.palette value as the fallback, so the
   card follows a :root retheme in index.html and still renders alone in the
   harness. Cinzel caps for the heading, serif body, radius <= 6 px.
   ════════════════════════════════════════════════════════════════════════════ */
import { SC } from './tuning.js';

/* ── words ─────────────────────────────────────────────────────────────── */

const BADGES = Object.freeze([
  Object.freeze({ key: 'transport', label: 'Transport',        glyph: '🚚', node: 'transport',    meaning: 'ships through the Transport company' }),
  Object.freeze({ key: 'market',    label: 'Marketplace',      glyph: '🏪', node: 'ch:market',    meaning: 'sells on the Marketplace' }),
  Object.freeze({ key: 'carMarket', label: 'Car Marketplace',  glyph: '🚗', node: 'ch:carmarket', meaning: 'tied to the Car Marketplace' }),
  Object.freeze({ key: 'card',      label: 'Good for Battlers', glyph: '🃏', node: 'sys:battle',   meaning: 'what it makes is useful to battlers and camp training' }),
]);

const KIND_LABEL = Object.freeze({
  system: 'System', channel: 'Trade channel', hub: 'Transport hub', producer: 'Just Business',
  service: 'Service business', cityTransit: 'City transit',
});

const HINT = 'Click for the full plan';

/* Strip the parts of a sibling's sentence that belong in a cite, not on a
   card: bracketed symbol names "(RESTAURANT_FOOD_MUL, read live)", file paths,
   and everything after the first full stop. The modal shows the whole thing. */
const firstSentence = (s) => {
  let t = String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  t = m ? m[1] : t;
  return t;
};

/* The card is a glance: one sentence, capped at a word boundary. The knob is
   read from SC.hover when the seam adds it (sc/decisions/hovercard.md asks for
   `maxWhatChars`); until then this presentation limit — not an economy number —
   is the fallback. */
const WHAT_CHARS_FALLBACK = 150;
const whatLimit = (max) => (Number.isFinite(max) && max > 20 ? max : WHAT_CHARS_FALLBACK);
/* Round 1 cut at the last word and left "…sells to Marketplace and…" hanging
   mid-clause. A clause boundary ("; " or ", ") past the middle is a cleaner
   cut: the sentence closes on a whole thought and only the tail is dropped. */
const clip = (s, max) => {
  const lim = whatLimit(max);
  const t = String(s || '');
  if (t.length <= lim) return t;
  const cut = t.slice(0, lim - 1);
  const semi = cut.lastIndexOf('; ');
  if (semi > lim * 0.45) return cut.slice(0, semi) + '.';
  const comma = cut.lastIndexOf(', ');
  if (comma > lim * 0.6) return cut.slice(0, comma) + '…';
  const sp = cut.lastIndexOf(' ');
  return (sp > lim * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
};
/* A sentence built from ranked clauses: drop the LEAST important clause until
   it fits, rather than slicing text — the "sells to" clause (the map) survives
   while "also X in the city sim" goes first. `parts` = [{text, rank}] in
   reading order; lower rank = dropped first. */
const fitParts = (parts, max) => {
  const lim = whatLimit(max);
  const live = parts.slice();
  const join = (ps) => ps.map((p, i) => (p.makes ? (i === 0 ? 'Makes ' : 'also ') : '') + p.text)
    .map((t, i) => (i === 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t)).join('; ') + '.';
  while (live.length > 1 && join(live).length > lim) {
    let k = 0;
    for (let i = 1; i < live.length; i++) if (live[i].rank < live[k].rank) k = i;
    if (k === 0) break;
    live.splice(k, 1);
  }
  /* the first clause always opens with "Makes"; a clause that was second
     ("also …") and is now first reads as "Makes …" via its own text */
  return join(live);
};
const endStop = (s) => (s && !/[.!?…]$/.test(s) ? s + '.' : s);

const joinNames = (names) => {
  const a = names.filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
};

/* ── the view-model ────────────────────────────────────────────────────── */

function resRow(data, id) {
  const cat = data && data.catalog;
  let row = null;
  try { row = cat && typeof cat.byId === 'function' ? cat.byId(id) : null; } catch (_) { row = null; }
  if (!row && cat && Array.isArray(cat.CATALOG)) row = cat.CATALOG.find((r) => r && r.id === id) || null;
  return row;
}

function resItem(data, r, extra) {
  const row = resRow(data, r.id);
  return Object.assign({
    id: r.id,
    name: row ? row.name || r.id : r.id,
    icon: row ? row.icon || '' : '',
    color: row ? row.color || null : null,
    known: !!row,
    live: r.live === true,
  }, extra || {});
}

function findNode(data, id) {
  const g = data && data.graph;
  const nodes = g && Array.isArray(g.nodes) ? g.nodes : [];
  return nodes.find((n) => n && n.id === id) || null;
}

const nodeLabel = (data, id) => { const n = findNode(data, id); return n ? n.label : id; };

/* ONE BUSINESS CHIP — and the round-2 bug it exists to kill.
   A chip on a "Needs from businesses" list carries TWO different facts and
   round 2 printed one word for both: `live` on a bizNeeds row is whether the
   SUPPLY LINK is live, and the card stamped "map · planned" on it. On 28 of
   the 64 business chips that put the word "planned" next to a business that is
   running in the game today — Genetics Lab called the Research Facility, the
   Agricultural Op., Home Feed AND the Mining Company "planned" — while on the
   same card a genuinely planned tile (Fashion Brand) got the identical word.
   A player reads "planned" as "not in the game yet" and skips the exact
   partner the owner drew, which is contract rule 3 backwards: a LIVE fact
   presented as proposed.
   So the word now names WHICH fact it is about:
     the node is planned      -> "planned"      (📐, dimmed: it does not exist)
     the node runs, link does not -> "no route yet" (🏭 full strength, dashed
                                   border: the business is real, the lane is
                                   the owner's drawing)
     both live and drawn      -> "map"
   `route` (link) and `live` (node) are separate fields from here on so no
   later view can collapse them again. */
function bizChip(data, id, opt) {
  const o = opt || {};
  const other = findNode(data, id);
  const plannedNode = !!(other && other.status === 'planned');
  const name = other ? other.label : id;
  const hasLink = typeof o.linkLive === 'boolean';
  const routeLive = hasLink ? o.linkLive === true : true;
  let tag = null, title = name;
  if (plannedNode) { tag = { text: 'planned', kind: 'planned' }; title = name + ' is on the owner\'s map only — not in the game yet'; }
  else if (hasLink && !routeLive) { tag = { text: 'no route yet', kind: 'route' }; title = name + ' runs in the game today; this supply route between the two is on the owner\'s map, not in the game yet'; }
  else if (o.onMap) { tag = { text: 'map', kind: 'map' }; title = name + ' — drawn on the owner\'s map'; }
  /* a system or a channel reached through the same chip (the "Sells to" list
     ends at the Marketplace as often as at a tile), so the glyph names WHAT
     KIND of thing it is instead of stamping a factory on the Camp */
  const icon = plannedNode ? '📐'
    : other && other.type === 'channel' ? (id === 'ch:carmarket' ? '🚗' : '🏪')
      : other && other.type === 'system' ? '🌐' : '🏭';
  return {
    id, name, biz: true, icon,
    live: !plannedNode, route: routeLive, onMap: o.onMap === true, planned: plannedNode,
    tag, title,
  };
}

/* HOW COMMON IS THIS LOOT? — how many business tiles on the map list the id as
   a themed need. Derived once per graph and cached on it, because hoverVM runs
   on pointermove.

   ROUND 2 GOT THIS WRONG WITH A THRESHOLD. "A staple is an id at least a third
   of the tiles want" only ever caught fuel (14/27) and metal (10/27); supplies,
   water, memoryShards and food (5,5,5,4) fell under the bar, so the half-the-
   slots cap never fired on them and six pairs of business cards still shared 3
   of their 4 chips — Trash Crusher read "Water, Supplies, Metal, Fuel" and
   Restaurant "Food, Water, Supplies, Metal". A threshold is the wrong shape:
   it asks "is this id common in absolute terms" when the card's question is
   "which of THIS tile's needs say something about this tile". The pick below
   is therefore RANK-based (see lootPick) and no threshold survives. */
const lootFreqCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function lootFreq(data) {
  const g = data && data.graph;
  const empty = { freq: new Map(), tiles: 0 };
  if (!g || !Array.isArray(g.nodes)) return empty;
  if (lootFreqCache && lootFreqCache.has(g)) return lootFreqCache.get(g);
  const freq = new Map(); let tiles = 0;
  for (const n of g.nodes) {
    if (!n || n.type !== 'business') continue;
    tiles++;
    for (const p of Array.isArray(n.lootNeeds) ? n.lootNeeds : []) if (p && p.themedLoot) freq.set(p.id, (freq.get(p.id) || 0) + 1);
  }
  const out = { freq, tiles };
  if (lootFreqCache) lootFreqCache.set(g, out);
  return out;
}

/* An even spread through a long list, so a sample of 409 loot ids is not just
   the four the list happens to start with. Deterministic: the same node always
   shows the same four chips. */
function spread(ids, k) {
  const a = Array.isArray(ids) ? ids : [];
  if (a.length <= k) return a.slice();
  const step = a.length / k, out = [];
  for (let i = 0; i < k; i++) out.push(a[Math.floor(i * step)]);
  return out;
}

/* ROUND 7 — SPREAD, BUT NEVER TWICE THROUGH THE SAME MOUTH.
   `spread` samples by POSITION, which is blind to the only thing the sample is
   for: the four chips exist to show the reader four different parties. Three of
   the four "Made by its businesses" ids on Just Business came off the
   Agricultural Op.'s shelf, so the column argued that the whole business system
   is one farm. `spreadBy` starts at the same evenly-spaced positions `spread`
   would and, when the candidate there would repeat an answer already taken,
   walks forward (wrapping) to the first candidate with an unspoken-for one.
   Deterministic — same node, same four chips — and it degrades to exactly
   `spread` when every key is distinct or every key has been used.
   keyFn returning null/undefined means "this one cannot repeat anybody". */
function spreadBy(items, k, keyFn, preUsed) {
  const a = Array.isArray(items) ? items : [];
  if (a.length <= k) return a.slice();
  /* preUsed = the answers already printed ABOVE this sample (a channel's seeded
     theme goods), so the spread does not re-say one of them as its next pick */
  const step = a.length / k, used = new Set(preUsed || []), taken = new Set(), out = [];
  for (let i = 0; i < k; i++) {
    const start = Math.floor(i * step);
    let pick = -1, fallback = -1;
    for (let j = 0; j < a.length; j++) {
      const idx = (start + j) % a.length;
      if (taken.has(idx)) continue;
      if (fallback < 0) fallback = idx;
      const key = keyFn(a[idx]);
      if (key == null || !used.has(key)) { pick = idx; if (key != null) used.add(key); break; }
    }
    if (pick < 0) pick = fallback;
    if (pick < 0) break;
    taken.add(pick); out.push(a[pick]);
  }
  return out;
}

/* ROUND 7 — WHAT FALLS HERE AND NOWHERE ELSE, FIRST.
   The Battle System and the Camp both drop most of the catalogue, and both
   lists start with the same staples, so both cards opened with "Food · wanted
   by Home Feed +3 / Seaweed · wanted by Fishing Company +1" over a near-
   identical Produces line and read as one card. The two systems are not the
   same place, and the data already says how they differ: 414 ids come home
   from the camp, 409 fall in a battle, and the two sets are not equal. A loot
   system's sample is therefore ordered so the ids NO OTHER loot system drops
   come first. Derived from the graph (every `type:'system'` node with its own
   `produces.drops`), never from a system id typed here — add a third loot
   system and the three cards separate themselves. If a system has no id of its
   own the order is left exactly as it was. */
const sibDropCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function siblingDrops(data, selfId) {
  const g = data && data.graph;
  if (!g || !Array.isArray(g.nodes)) return new Set();
  let per = sibDropCache ? sibDropCache.get(g) : null;
  if (!per && sibDropCache) { per = new Map(); sibDropCache.set(g, per); }
  if (per && per.has(selfId)) return per.get(selfId);
  const s = new Set();
  for (const x of g.nodes) {
    if (!x || x.type !== 'system' || x.id === selfId || !x.produces) continue;
    for (const id of Array.isArray(x.produces.drops) ? x.produces.drops : []) s.add(id);
  }
  if (per) per.set(selfId, s);
  return s;
}
function ownDropsFirst(data, selfId, ids) {
  const list = Array.isArray(ids) ? ids : [];
  const sib = siblingDrops(data, selfId);
  const mine = list.filter((id) => !sib.has(id));
  if (!mine.length || mine.length === list.length) return list;
  return mine.concat(list.filter((id) => sib.has(id)));
}

/* Which resource ids anything on the map actually makes TODAY. A system card
   names ids its facilities produce; whether each one is live is a per-id fact
   the business nodes already carry, so it is read from them rather than
   assumed (contract rule 3: no live/planned guess on a card). */
const liveMakeCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function liveMakeIds(data) {
  const g = data && data.graph;
  if (!g || !Array.isArray(g.nodes)) return new Set();
  if (liveMakeCache && liveMakeCache.has(g)) return liveMakeCache.get(g);
  const set = new Set();
  for (const n of g.nodes) for (const m of Array.isArray(n && n.makes) ? n.makes : []) if (m && m.live === true) set.add(m.id);
  if (liveMakeCache) liveMakeCache.set(g, set);
  return set;
}

/* Every business that sells into a trade channel, in map order. The Marketplace
   and Car Marketplace tiles have no makes, no needs and no badges of their own:
   this IS their content. */
function channelSellers(data, id) {
  const g = data && data.graph;
  const out = [], seen = new Set();
  for (const e of (g && g.edges) || []) {
    if (!e || e.kind !== 'channel' || e.to !== id || seen.has(e.from)) continue;
    seen.add(e.from); out.push(e.from);
  }
  return out;
}

/* ── WHAT A COUNTER IS NAMED AFTER ───────────────────────────────────────
   ROUND 6, and the worst thing on the six cards. The Car Marketplace's
   "Traded here" printed "Fuel · from Oil Company / Butane · from Oil Company /
   Wheat · from Agricultural Op. / Wool · from Home Feed  +42 more" — not one
   car, on the counter the PDF legend pins to the Car Dealer, the Car Factory
   and Salvage. `cars` IS a live good there; the card's own seller chip says
   "Car Dealer · brings Cars, Metal +2" two rows below. The cause is the
   sampler: spread() walks a 46-good array by index and the Oil Company's 18
   goods sit at the front of it, so the one good the stall is named for is
   never on a four-slot sample. A card that contradicts itself is worse than a
   thin one.
   So a channel names its own good FIRST, and this derives which that is rather
   than writing "cars" down anywhere: take the distinctive words of the
   channel's own label (everything that is not a generic counter word), match
   them against the goods' names and the sellers' names by whole word with a
   plural stripped — "Car Marketplace" -> "car" -> Cars, Car Parts, Car Dealer,
   Car Factory; "Cardboard" is not a match because the whole word differs.
   The general Marketplace keeps NO theme once "marketplace" is dropped, which
   is the right answer: it is named after nothing in particular and its sample
   should stay a spread. Nothing here is a list of ids, so a channel the owner
   renames or adds gets the same behaviour for free. */
const COUNTER_WORD = /^(the|a|an|of|and|market|marketplace|exchange|counter|trade|trading|shop|stall|hub|bazaar)$/i;
const stem = (w) => String(w || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
const wordsOf = (s) => String(s || '').split(/[^A-Za-z]+/).filter(Boolean);
function channelTheme(data, n, sellerIds, goods) {
  if (!n || n.type !== 'channel') return null;
  const keys = wordsOf(n.label).filter((w) => !COUNTER_WORD.test(w)).map(stem).filter((w) => w.length > 2);
  if (!keys.length) return null;
  const hit = (label) => wordsOf(label).map(stem).some((w) => keys.indexOf(w) >= 0);
  const goodIds = (goods || []).filter((gd) => hit(resItem(data, gd).name) || hit(gd.id)).map((gd) => gd.id);
  const sellers = (sellerIds || []).filter((sid) => hit(nodeLabel(data, sid)));
  if (!goodIds.length && !sellers.length) return null;
  /* the noun the card will use in its own sentences — the counter's own good
     when it has one ("Cars"), else the seller it is named for */
  const noun = goodIds.length ? resItem(data, { id: goodIds[0] }).name : nodeLabel(data, sellers[0]);
  return { keys, goodIds, sellers, noun };
}

/* ── WHO WANTS THIS RESOURCE (coverage.USES) ─────────────────────────────
   The owner's headline sentence is "make sure (all) of the 100+ resources that
   we have in the game has a use", and coverage.js already answers it: 424 of
   424 catalogue ids have a USES row and uncovered() returns 0. Round 4 printed
   that number NOWHERE — the Battle System card named four drops out of 409 and
   said nothing about the other 405, which is the one card the owner is most
   likely to open first.
   These helpers READ coverage; they never write the count down. A USES entry
   deleted in coverage.js drops the printed number by one, which is exactly what
   makes the sentence worth printing (a literal "409 of 409" would keep saying
   409 after the data rotted). Costly over 409 ids, so it is memoised per graph:
   hoverVM runs on pointermove. */
function usesRows(data, id) {
  const U = data && data.coverage && data.coverage.USES;
  if (!U) return [];
  const rows = typeof U.get === 'function' ? U.get(id) : U[id];
  return Array.isArray(rows) ? rows : [];
}
const bizIdCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function businessIds(data) {
  const g = data && data.graph;
  if (!g || !Array.isArray(g.nodes)) return new Set();
  if (bizIdCache && bizIdCache.has(g)) return bizIdCache.get(g);
  const s = new Set();
  for (const n of g.nodes) if (n && n.type === 'business') s.add(n.id);
  if (bizIdCache) bizIdCache.set(g, s);
  return s;
}
/* the BUSINESS tiles that want an id — a system or a channel "using" it is not
   what the owner's sentence is about ("all the businesses needs what can be
   found in the loot system") */
function wantedBy(data, resId) {
  const biz = businessIds(data), out = [], seen = new Set();
  for (const u of usesRows(data, resId)) {
    if (!u || !biz.has(u.by) || seen.has(u.by)) continue;
    seen.add(u.by); out.push(u.by);
  }
  return out;
}
const dropCovCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function dropCoverage(data, nodeId, ids) {
  const g = data && data.graph;
  let per = dropCovCache && g ? dropCovCache.get(g) : null;
  if (!per && dropCovCache && g) { per = new Map(); dropCovCache.set(g, per); }
  if (per && per.has(nodeId)) return per.get(nodeId);
  let covered = 0;
  for (const id of ids) if (wantedBy(data, id).length) covered++;
  const out = { covered, total: ids.length };
  if (per) per.set(nodeId, out);
  return out;
}
/* who MAKES an id, for a "made by its businesses" chip: the graph already
   knows, and a chip that says "Rice · Agricultural Op." is the difference
   between a list of nouns and a map */
const makerCache = typeof WeakMap === 'function' ? new WeakMap() : null;
function makerIndex(data) {
  const g = data && data.graph;
  if (!g || !Array.isArray(g.nodes)) return new Map();
  if (makerCache && makerCache.has(g)) return makerCache.get(g);
  const m = new Map();
  for (const n of g.nodes) {
    if (!n || n.type !== 'business') continue;
    for (const mk of Array.isArray(n.makes) ? n.makes : []) {
      if (!mk) continue;
      if (!m.has(mk.id)) m.set(mk.id, []);
      const a = m.get(mk.id); if (a.indexOf(n.id) < 0) a.push(n.id);
    }
  }
  if (makerCache) makerCache.set(g, m);
  return m;
}
/* "Weapon Smith +6" — one name and a count, never a list: the sub-line is the
   only shrinkable part of a chip and a second name never survives 320 px. */
function whoLine(data, ids, verb) {
  if (!ids || !ids.length) return null;
  const rest = ids.length - 1;
  return verb + ' ' + nodeLabel(data, ids[0]) + (rest > 0 ? ' +' + rest : '');
}
/* ROUND 6 — TWO CHIPS IN A COLUMN MAY NOT SAY THE SAME WORDS.
   Three of the six cards printed one sub-line three times: "Corn · made by
   Agricultural Op. / Rice · made by Agricultural Op. / …" and, on the Car
   Marketplace, two goods "from Oil Company". The letter of "every chip carries
   a sub-line" was met and the column still told the reader one thing.

   ROUND 7 — AND A SUB-LINE MAY NOT ANSWER A DIFFERENT QUESTION THAN ITS
   SECTION ASKS. Round 6 broke the repeat by switching the QUESTION: under the
   heading "Made by its businesses" the third chip read "Rice · wanted by
   Restaurant +1", and on the Car Marketplace "Reprocessed Slop · wanted by
   Fishing Company" sat among "from X" chips. Both sentences are true and both
   are answers to a question the reader was not asking, which is worse than a
   repeat — the heading is the contract for the column under it.
   The repeat is now broken one step EARLIER instead, by `spreadBy` picking a
   sample whose answers already differ (see below), and this function only
   walks the SAME question to a different member of the answering list:
   an id made by two tiles can name the second when the first is spoken for.
   If every member is spoken for the repeat stands — telling the reader the
   truth twice beats telling them something else once. */
function sameQuestionSub(data, ids, verb, used) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const rest = list.length - 1;
    const s = verb + ' ' + nodeLabel(data, list[i]) + (rest > 0 ? ' +' + rest : '');
    if (!used.has(s)) { used.add(s); return s; }
  }
  return whoLine(data, list, verb);
}
/* what a tile is FOR, in a chip's worth of words: its live products, else its
   service sentence with the "works only for the city" preamble stripped (it is
   already said by the card the chip sits on). */
function tileSub(data, n, maxNames) {
  const mk = (Array.isArray(n.makes) ? n.makes : []);
  const live = mk.filter((m) => m.live).slice(0, maxNames || 2);
  const any = (live.length ? live : mk.slice(0, maxNames || 2)).map((m) => resItem(data, m).name);
  if (any.length) return any.join(', ') + (mk.length > any.length ? ' +' + (mk.length - any.length) : '');
  /* ROUND 6: a planned tile used to stop here — "Airport · no product on the
     map yet" was the City Builder's third chip and it is the FALLBACK text,
     not a fact: it says only that the branch above found nothing. The Airport
     has no products precisely because it is not a factory; what it IS is
     written on the node (`service`: long-range NPC trade with other cities and
     camps). So a planned tile now falls through to the same service sentence a
     live service tile uses, and "no product on the map yet" survives only for
     a tile that genuinely has nothing said about it anywhere. */
  const svc = firstSentence(n.service || n.caption || '');
  if (!svc) return n.status === 'planned' ? 'no product on the map yet' : null;
  const t = svc.replace(/^works only for the city:\s*/i, '').replace(/^(lets|unlocks)\s+/i, '');
  /* a service sentence is a sentence; a chip is a chip. Cut at the first clause
     boundary so the Bus Company reads "bus stops and routes" instead of its
     whole paragraph ellipsised down to nothing on a 320 px card. */
  const head = t.replace(/\.$/, '').split(/\s+so\s+|,\s*/)[0];
  const use = head.length >= 12 ? head : t.replace(/\.$/, '');
  return use ? use.charAt(0).toLowerCase() + use.slice(1) : null;
}

/* Where a business sells, DRAWN FIRST: the channel icons on its tile and the
   tiles the PDF draws as needing it (graph buyers with pdf:true), then the
   recipes' sellsTo. Returns [{id, label, onMap}]. */
function sellsRanked(data, n) {
  const seen = new Map();
  const add = (id, onMap) => { if (!id || id === n.id) return; const cur = seen.get(id); if (!cur) seen.set(id, { id, label: nodeLabel(data, id), onMap }); else if (onMap) cur.onMap = true; };
  const badges = n.badges || {};
  if (badges.market === true) add('ch:market', true);
  if (badges.carMarket === true) add('ch:carmarket', true);
  for (const b of Array.isArray(n.buyers) ? n.buyers : []) if (b && b.pdf === true) add(b.biz, true);
  for (const t of Array.isArray(n.sellsTo) ? n.sellsTo : []) add(t, false);
  return Array.from(seen.values()).sort((a, b) => (a.onMap === b.onMap ? 0 : a.onMap ? -1 : 1));
}

/**
 * hoverVM(id, data) -> the card's content for one node. PURE.
 *   data = {catalog, businesses, recipes, coverage, shipping, loot, graph}
 *          (+ optional opLabel(id): the in-game name over the bridge, injected
 *           by the shell — this file never imports sc.bridge.js).
 * Always returns an object; an unknown id gives known:false and a card that
 * says so rather than throwing in the middle of a pointermove.
 */
export function hoverVM(id, data) {
  const n = findNode(data, id);
  const maxMakes = SC.hover.maxMakes, maxNeeds = SC.hover.maxNeeds;
  if (!n) {
    return { id, known: false, name: String(id), kindLine: 'Not on the map', what: 'This id is not a node of the supply chain map.',
      status: 'unknown', statusTag: '?', makes: [], makesMore: 0, lootNeeds: [], lootMore: 0, bizNeeds: [], bizMore: 0,
      resSample: [], resSampleMore: 0, resSampleLabel: '', bizList: [], bizListMore: 0, bizListLabel: '',
      extraList: [], extraMore: 0, extraLabel: '',
      sells: [], sellsMore: 0, sellsLabel: '', badgeNote: null,
      badges: [], produces: null, liveLine: null, coverLine: null, hint: HINT, planned: false };
  }
  const status = n.status === 'planned' ? 'planned' : 'live';
  const planned = status === 'planned';
  const statusTag = (SC.status[status] && SC.status[status].tag) || status.toUpperCase();

  /* the in-game name, when the shell hands one over and it differs */
  let gameName = null;
  if (n.opId && data && typeof data.opLabel === 'function') {
    try { const l = data.opLabel(n.opId); if (typeof l === 'string' && l && l !== n.opId && l !== n.label) gameName = l; } catch (_) { gameName = null; }
  }

  /* kind line */
  const sysLabel = n.type === 'business' && n.system ? nodeLabel(data, n.system) : null;
  let kindLine;
  if (n.type === 'system') kindLine = KIND_LABEL.system + (n.page ? ' · map p' + n.page : '');
  else if (n.type === 'channel') kindLine = KIND_LABEL.channel + ' · map legend';
  else kindLine = (KIND_LABEL[n.kind] || KIND_LABEL.producer) + (sysLabel && n.kind !== 'producer' ? ' · ' + sysLabel : '') + (n.page ? ' · map p' + n.page : '');
  if (gameName) kindLine += ' · "' + gameName + '" in game';

  /* makes: live first, then the owner's wishes */
  /* order: what lands in a player's stash today, then the city sim's yields,
     then the owner's wishes — so the first chip is always the truest one */
  const makeRank = (m) => (m.live && m.via !== 'cityFirm' ? 0 : m.live ? 1 : 2);
  const makesAll = (Array.isArray(n.makes) ? n.makes : []).slice()
    .sort((x, y) => makeRank(x) - makeRank(y));
  /* `by` is the thing that actually yields the id — for the City Builder, the
     building ("Food · Hydroponics Bay"). It was computed by the graph and
     dropped by the renderer, which left the City card printing 130 nouns with
     no hint that a player has to BUILD something to get them. */
  /* ROUND 7: and when `by` IS set, four chips must name four different yielders.
     The City Builder's first four read "Food · Hydroponics Bay / Water · Water
     Reclaimer / Metal · Smelting Foundry / Ingots · Smelting Foundry" — the
     fourth chip spent a whole row re-naming the third's foundry when 126 other
     ids were waiting. A repeat is SKIPPED, not dropped: if the list runs out
     the skipped ones come back, so the card never shows fewer chips than it
     used to. A tile whose makes carry no `by` (every business card) keeps the
     old first-k slice exactly, which is what preserves "the first chip is the
     truest one" — the rank sort above must not be shuffled. */
  const pickMakes = (list, k) => {
    const out = [], used = new Set(), skipped = [];
    for (const m of list) {
      if (out.length >= k) break;
      const key = m && m.by;
      if (key && used.has(key)) { skipped.push(m); continue; }
      if (key) used.add(key);
      out.push(m);
    }
    for (const m of skipped) { if (out.length >= k) break; out.push(m); }
    return out;
  };
  const makes = pickMakes(makesAll, maxMakes).map((m) => resItem(data, m, { via: m.via || null, by: m.by || null, sub: m.by || null }));

  /* needs from battle loot. The graph hands them themed-first, but the round-1
     card led Medical, Home Feed, Camp and the City with the same Food / Water /
     Medicine / Supplies four, and Medical "needed" the Medicine it makes. Two
     rules for the four visible slots: never show a need this tile itself makes
     (it is still in the count), and spend at most half the slots on STAPLES —
     ids that most tiles on the map want — so the rest say what THIS business
     is about (Medical: Memory Shards, DNA, Cloth). Staples are derived from the
     graph, never listed here. The modal shows the full list unchanged. */
  const makeIds = new Set((Array.isArray(n.makes) ? n.makes : []).map((m) => m.id));
  /* WHAT THE TILE ACTUALLY BURNS TODAY. `n.upkeep` is the live, cited side of
     "what does it need to run" — an OPS_ECON input read through _opEcon, or a
     sub-screen recipe (the Hospital bench). Round 3 never read it, so ten
     tiles that DO consume something in the shipped game (medical, research,
     rail, bus, cars, construction, trashcrusher, weaponsmith, feed, genelab)
     could still draw four all-proposed chips and a footer saying nothing was
     live. Every upkeep id is also a loot need, so it is not a new section: it
     wins the first slots and is stamped so the player can tell "the game takes
     this from you today" from "the map would like it to". */
  const upkeepBy = new Map();
  for (const u of Array.isArray(n.upkeep) ? n.upkeep : []) if (u && u.id) upkeepBy.set(u.id, u);
  /* WHERE IT DROPS. loot.js gives each need an ordered list of sources and the
     generic salvage pool ("Exotic salvage off any body") is first on most ids,
     so naming where[0] made every chip on the Bank card say the same words. A
     `themed` source is a PLACE (Church ruins, School ruins, Wrecked cars) and
     is what the owner's "all the businesses need what the loot system drops"
     is actually asking to be told, so it wins. */
  const namedDrop = (p) => (Array.isArray(p.where) ? p.where : []).some((x) => x && x.themed === true);
  const dropLabel = (p) => {
    const w = Array.isArray(p.where) ? p.where : [];
    const pick = w.find((x) => x && x.themed === true) || w[0] || null;
    return pick && pick.label ? pick.label : null;
  };
  const { freq: lootShare } = lootFreq(data);
  const shareOf = (p) => lootShare.get(p.id) || 0;
  /* "never show a need this tile itself makes" (round 1: Medical "needing" the
     Medicine it makes) — EXCEPT an id the op genuinely burns. The Genetics Lab
     yields DNA and takes medicine as its OPS_ECON input while a camp bench
     also lets it make medicine; hiding the input left the card with four
     proposed chips and a live one it was told to ignore. */
  const lootAll = (Array.isArray(n.lootNeeds) ? n.lootNeeds : []).filter((p) => !makeIds.has(p.id) || upkeepBy.has(p.id));
  /* HALF THE SLOTS GO TO THE LEAST SHARED NEEDS. No threshold (see lootFreq):
     the first half of the slots follow the graph's own order — themed, then
     live, the needs this tile leads with — and the rest are filled RAREST
     FIRST, the ids fewest other tiles on the map want. That is what makes one
     business card read differently from another: two tiles can now collide on
     at most half the chips however common their shared needs are. The modal
     shows the full list, unchanged and unsorted. */
  const themed = lootAll.filter((p) => p.themedLoot === true);
  const rarePool = (themed.length ? themed : lootAll).slice()
    .sort((a, b) => (shareOf(a) - shareOf(b)) || (lootAll.indexOf(a) - lootAll.indexOf(b)));
  const lootPick = [];
  const take = (p) => { if (p && lootPick.length < maxNeeds && lootPick.indexOf(p) < 0) lootPick.push(p); };
  const leadSlots = Math.floor(maxNeeds / 2);
  /* An id the game already takes off this tile beats anything proposed — but
     only for HALF the slots. Medical burns six; letting them all in filled the
     card with staples (food, water, supplies) and dropped the two chips that
     say what a hospital is (Chemicals, Cybernetic Parts). Same reasoning as
     the staple cap below: half the card is the live truth, half is this tile. */
  for (const p of lootAll) { if (lootPick.length >= leadSlots) break; if (upkeepBy.has(p.id)) take(p); }
  /* then the lead slots, but a need with a NAMED drop site first: a chip that
     says "Gold Bars — Church ruins" tells a player where to go; four chips all
     saying "exotic salvage off any body" tell them nothing and were what made
     the Bank the least informative card on the map. Ties keep the graph's
     order, so this only ever reorders within equally-ranked needs. */
  const leadPool = lootAll.slice()
    .sort((a, b) => ((namedDrop(a) ? 0 : 1) - (namedDrop(b) ? 0 : 1)) || (lootAll.indexOf(a) - lootAll.indexOf(b)));
  for (const p of leadPool) { if (lootPick.length >= leadSlots) break; take(p); }
  for (const p of rarePool) { if (lootPick.length >= maxNeeds) break; take(p); }
  for (const p of lootAll) { if (lootPick.length >= maxNeeds) break; take(p); }
  /* keep the graph's order (themed, then live) inside the pick */
  lootPick.sort((a, b) => lootAll.indexOf(a) - lootAll.indexOf(b));
  /* ROUND 6 — A SUB-LINE THAT REPEATS THE ONE ABOVE IT IS NOT A SECOND FACT.
     Round 5 satisfied the letter of "every chip carries a sub-line" and then
     printed, on the City Builder, "Rations · Exotic salvage off any body /
     Planks · Exotic salvage off any body / Remedies · Exotic salvage off any
     body". Three chips, one sentence. The generic salvage pool is where[0] for
     ~350 of the 424 ids, so any card whose picks fall in it says the same
     words as many times as it has slots.
     Every one of those ids ALSO drops in the camp's salvage haul and in
     world-map salvage (loot.js `where` carries all three), so the fix asserts
     nothing new: when the label this chip would print has already been printed
     on this card, take the next place in the id's own `where` list that has
     not. The chip is still true, and the column now names three different
     places to go. Only if the id has no second source does it repeat. */
  const usedWhere = new Set();
  const lootNeeds = lootPick.map((p) => {
    const up = upkeepBy.get(p.id) || null;
    let where = dropLabel(p);
    if (where && usedWhere.has(where)) {
      const alt = (Array.isArray(p.where) ? p.where : [])
        .map((x) => (x && x.label) || null).filter((l) => l && !usedWhere.has(l));
      if (alt.length) where = alt[0];
    }
    if (where) usedWhere.add(where);
    return resItem(data, p, {
      themed: p.themedLoot === true,
      sharedWith: Math.max(0, shareOf(p) - 1),
      where,
      /* the visible second fact on the chip. The card sets pointer-events:none
         (the bar: it must never eat a click meant for the map), so a `title`
         can never fire — anything the player must be able to read has to be
         drawn. */
      sub: where,
      burns: up ? (up.via === 'opsInput' ? 'ops' : 'bench') : null,
      burnsCite: up ? up.cite || null : null,
    });
  });

  /* needs from businesses. THE OWNER'S DRAWING WINS THE SLOTS: round 1 ranked
     live derived suppliers first and the four-slot cap then hid both of the
     Research Facility's drawn suppliers (Genetics Lab, Medical) behind "+4
     more" and the Fashion Brand behind Medical — the owner's own cloth -> medical
     example. Rank: drawn on the PDF, then live today, then the rest; and every
     drawn supplier is kept even past the cap, so the cut only ever falls on a
     derived one. `onMap` marks them so the card can say which is which. */
  const bizAll = (Array.isArray(n.bizNeeds) ? n.bizNeeds : []).slice()
    .sort((a, b) => (a.pdf === b.pdf ? 0 : a.pdf ? -1 : 1) || (a.live === b.live ? 0 : a.live ? -1 : 1));
  const drawnCount = bizAll.filter((b) => b.pdf === true).length;
  /* WHAT RIDES THE LANE, ON THE CHIP. The owner's one worked example is
     "the fashion designer company can produce cloth and can send through
     transport to medical company" — and until now the Medical card named the
     Fashion Brand and never the cloth. The cargo was computed here and thrown
     away by the renderer; the escape hatch (a `title` sentence) cannot fire on
     a pointer-events:none card. So the goods are now part of the chip's own
     text: "Fashion Brand · Cloth, Fabric". `upkeepCargo` is folded in after
     `cargo` because an upkeep lane is the live half of the same hand-off. */
  const cargoLine = (ids, liveIds) => {
    const items = ids.slice(0, 2).map((cid) => resItem(data, { id: cid, live: (liveIds || []).indexOf(cid) >= 0 }));
    const rest = Math.max(0, ids.length - items.length);
    return { items, text: items.map((c) => c.name).join(', ') + (rest ? ' +' + rest : '') };
  };
  const bizNeeds = bizAll.slice(0, Math.max(maxNeeds, drawnCount)).map((b) => {
    const other = findNode(data, b.biz);
    const plannedNode = !!(other && other.status === 'planned');
    const ids = (b.cargo || []).concat((b.upkeepCargo || []).filter((x) => (b.cargo || []).indexOf(x) < 0));
    const c = cargoLine(ids, b.liveIds || []);
    return Object.assign(bizChip(data, b.biz, { linkLive: b.live === true, onMap: b.pdf === true }), {
      pdf: b.pdf === true, planned: plannedNode,
      cargo: c.items, cargoMore: Math.max(0, ids.length - c.items.length), sub: c.text || null,
    });
  });

  /* badges: the four PDF legend icons; '?' = drawn, but maybe the neighbour's */
  const badges = BADGES.filter((b) => n.badges && n.badges[b.key]).map((b) => ({
    key: b.key, label: b.label, glyph: b.glyph, doubt: n.badges[b.key] === '?' || (Array.isArray(n.badgeDoubt) && n.badgeDoubt.indexOf(b.key) >= 0), meaning: b.meaning,
  }));
  /* the goal's rule versus the drawing: the map has no truck on this tile but
     the owner wrote that every business ships through Transport */
  if (n.type === 'business' && !n.truckDrawn && n.goalSaysTransport && n.id !== 'transport') {
    badges.push({ key: 'transport', label: 'Transport', glyph: '🚚', doubt: true, meaning: 'no truck drawn on the map; the written goal routes it through Transport', goalOnly: true });
  }

  /* ── WHERE ITS GOODS GO, AND WHAT RIDES ────────────────────────────────
     The other half of the owner's sentence. Round 3 drew "Needs from …" and
     never "Sells to …", so the Mining Company — which nine tiles on the PDF
     buy from — had no business chip at all, and the Fashion Brand's whole
     reason for existing (cloth -> Medical) was invisible from the Fashion end.
     `n.buyers` already carries the drawn lane AND its cargo; the channel
     badges carry the stalls. Ranked exactly like the needs list: drawn on the
     PDF first, then live, then derived. Service tiles say "Serves" because a
     Bank ships nothing — it is the same fact in the right word. */
  let sells = [], sellsMore = 0, sellsLabel = '';
  if (n.type === 'business') {
    const rows = [], seenS = new Set();
    const pushS = (tid, ids, liveIds, onMap) => {
      if (!tid || tid === n.id || seenS.has(tid)) return;
      seenS.add(tid); rows.push({ id: tid, ids: ids || [], liveIds: liveIds || [], onMap: onMap === true });
    };
    const buyers = (Array.isArray(n.buyers) ? n.buyers : []).slice()
      .sort((a, b) => ((a.pdf === b.pdf ? 0 : a.pdf ? -1 : 1)) || ((a.live === b.live ? 0 : a.live ? -1 : 1)));
    /* ⚠ A LIVE LANE DOES NOT MAKE EVERY ID ON IT LIVE. This used to say
       `b.live ? b.cargo : []` — the whole cargo inherited the lane's badge — so
       the Gas Station's hover card printed Diesel as a PLANNED product and then
       "Transport · Fuel, Diesel" with Diesel marked live, and the Mining card
       printed Metal LIVE and then "Oil Company · Metal" with Metal marked dead,
       because that one lane is planned. Same defect as the modal's buyer chips
       and the same fix: an id is live here when the LANE really carries it
       (`liveIds`) or when this tile's own product row says so — graph.js leaves
       a cityFirm product out of liveIds, and dropping it would delete Gasoline
       from the gas chip. bizNeeds above needs no union: there the product
       belongs to the OTHER tile, so the lane's own liveIds is the whole truth. */
    const ownLiveIds = new Set(makesAll.filter((m) => m && m.live !== false).map((m) => m.id));
    for (const b of buyers) {
      const ids = b.cargo || [];
      pushS(b.biz, ids, ids.filter((cid) => (b.live && (b.liveIds || []).indexOf(cid) >= 0) || ownLiveIds.has(cid)), b.pdf === true);
    }
    /* a stall carries whatever this tile makes; live goods first so the chip
       names something a player can actually carry there today */
    const ownGoods = makesAll.map((m) => m.id), ownLive = makesAll.filter((m) => m.live).map((m) => m.id);
    const stall = (key, tid) => { if (n.badges && n.badges[key]) pushS(tid, ownLive.length ? ownLive : ownGoods, ownLive, true); };
    stall('market', 'ch:market'); stall('carMarket', 'ch:carmarket');
    for (const t of Array.isArray(n.sellsTo) ? n.sellsTo : []) pushS(t, ownLive.length ? ownLive : ownGoods, ownLive, false);
    /* maxPartners, not maxNeeds: this is a "who buys from you" list and the
       tuning knob for that already exists. It is also the height budget — the
       card grew ~100 px when this section arrived and a 700 px card on a
       1366x768 screen drops into compact mode far too often. */
    const keep = rows.slice(0, SC.hover.maxPartners || maxNeeds);
    sells = keep.map((r) => {
      const c = cargoLine(r.ids, r.liveIds);
      return Object.assign(bizChip(data, r.id, { onMap: r.onMap }), { sub: c.text || null, cargo: c.items });
    });
    sellsMore = Math.max(0, rows.length - keep.length);
    sellsLabel = (n.kind === 'service' || n.kind === 'hub') ? 'Serves' : 'Sells to';
    if (sells.some((x) => x.onMap)) sellsLabel += ' · 🗺 on the map';
  }

  /* one sentence: what is it */
  /* ── SYSTEMS AND CHANNELS GET CHIPS TOO ─────────────────────────────────
     Round 2 gave four of the 33 nodes a card with no resource chip, no
     business chip and no badge: sys:battle was five lines of prose, ch:market
     was 128 px of "22 businesses on the map sell here" — naming none of them.
     Those two are the owner's most-referenced surfaces (the loot every
     business is supposed to draw from; the Marketplace stamped on every PDF
     page), and the data was already in hand — n.produces.drops holds the 409
     ids and the channel's seller set was built and thrown away. A system now
     names a spread of what comes out of it and the tiles it holds (or, for a
     system with no tiles of its own, the businesses that want its output); a
     channel names what is traded and who sells there. */
  /* ROUND 5: every chip on these six cards now carries the SECOND fact a
     business chip has carried since round 4. Round 4 measured 0 of their 32
     chips with a sub-line against 179 of 179 on the business cards, and the
     result was a column of bare nouns — "Food, Seaweed, Black Market Tokens,
     Concrete" — on the one card that is supposed to explain how loot feeds the
     whole economy. A drop says who wants it, a seller says what it brings, a
     tile says what it makes. All three facts were already on the graph or in
     coverage; none of them is written down here.
     `coverLine` and `footLine` are the other half: the owner's "make sure all
     the resources have a use" is TRUE and was never printed. */
  const liveMade = liveMakeIds(data);
  const sellerIds = n.type === 'channel' ? channelSellers(data, n.id) : [];
  /* hoisted out of the channel branch: the `what` sentence is built after it */
  let theme = null;
  let resSample = [], resSampleMore = 0, resSampleLabel = '';
  let bizList = [], bizListMore = 0, bizListLabel = '';
  let coverLine = null, footLine = null;
  /* a third chip list, used by the trade channels for their buyers (see below) */
  let extraList = [], extraMore = 0, extraLabel = '';
  let producesWord = 'a facility someone owns';
  if (n.type === 'system' && n.produces) {
    const pr = n.produces;
    /* A system whose own `makes` list is already drawn (the City Builder: 130
       ids with the facility that yields each) must not draw the SAME 130 ids a
       second time under "Made by its businesses". Round 4 put that list on the
       card three ways — Makes, the Produces count line, and the sample — and
       the card was 634 px of one fact. */
    const src0 = pr.drops.length ? pr.drops : (makesAll.length ? [] : pr.made);
    const isDrops = pr.drops.length > 0;
    /* ROUND 7: a loot system leads with the ids only IT drops (see
       ownDropsFirst) — the count under the sample is over the same list, so
       reordering it changes which four are named and nothing else. */
    const src = isDrops ? ownDropsFirst(data, n.id, src0) : src0;
    resSampleLabel = isDrops ? 'Drops here as loot' : 'Made by its businesses';
    const makers = isDrops ? null : makerIndex(data);
    /* ROUND 7: sample by WHO ANSWERS, not by position — four ids whose chips
       would all name the same farm/buyer are four chips that say one thing. */
    const picked = spreadBy(src, maxMakes, (rid) => (isDrops ? wantedBy(data, rid)[0] : (makers.get(rid) || [])[0]));
    const usedSub = new Set();
    resSample = picked.map((rid) => resItem(data, { id: rid, live: isDrops ? true : liveMade.has(rid) }, {
      /* a drop names the business that wants it (coverage.USES — the owner's
         "all the businesses need what the loot system drops", per id); a made
         id names the tile that makes it */
      /* "no buyer on the map yet" is never seen today (coverage covers all 424)
         and is exactly what must appear the day one stops being covered — a
         blank chip would hide it */
      sub: isDrops ? (sameQuestionSub(data, wantedBy(data, rid), 'wanted by', usedSub) || 'no buyer on the map yet')
        : (sameQuestionSub(data, (makers.get(rid) || []), 'made by', usedSub) || 'nothing on the map makes it yet'),
    }));
    resSampleMore = Math.max(0, src.length - picked.length);
    const members = (data.graph.nodes || []).filter((x) => x && x.type === 'business' && x.system === n.id);
    /* a system that has its own "Needs from businesses" section (the Camp buys
       ammo, medicine and food from four tiles) does NOT also get the generic
       "businesses that need it" roll-call: round 4 gave Battle and Camp the
       identical four names and the two cards read as one. */
    const ownNeeds = (Array.isArray(n.bizNeeds) ? n.bizNeeds : []).length > 0;
    if (members.length) {
      bizListLabel = 'Tiles in it';
      const rank = members.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0));
      bizList = rank.slice(0, maxNeeds).map((x) => Object.assign(bizChip(data, x.id, {}), { sub: tileSub(data, x, 2) }));
      bizListMore = Math.max(0, members.length - bizList.length);
    } else if (!ownNeeds) {
      /* no tiles of its own (the Battle System): the businesses that want what
         it produces, busiest first — the owner's "every business needs what
         the loot system drops", said with names, each one saying WHICH drop it
         is here for. */
      const themedOf = (x) => (x.lootNeeds || []).filter((p) => p.themedLoot);
      const want = (data.graph.nodes || []).filter((x) => x && x.type === 'business' && themedOf(x).length);
      bizListLabel = 'Businesses that need it';
      const rank = want.slice().sort((a, b) => themedOf(b).length - themedOf(a).length);
      /* ROUND 6 — THE TWO HALVES OF THE BATTLE CARD MUST MEET. Round 5 listed
         four drops (Food, Seaweed, Black Market Tokens, Concrete) and then, two
         rows below, four businesses whose subs named "Metal, Fuel", "Water,
         Metal", "Food, Water", "Fuel, Food" — the four commonest ids in the
         game and, bar one, none of the drops printed above. A reader cannot
         join the halves and the card argues nothing.
         Each business now names, first, a need that IS one of the drops this
         card just showed, and after that its RAREST need (fewest other tiles
         want it) rather than the graph's order, which is what the loot picker
         on a business card has done since round 2 and for the same reason:
         four tiles that all say "Metal, Fuel" are four tiles that say nothing.
         The count after the names is unchanged — the whole need list is still
         reported, only which two are named moves. */
      const shownDrops = new Set(picked);
      bizList = rank.slice(0, maxNeeds).map((x) => {
        const w = themedOf(x);
        const named = w.slice().sort((a, b) =>
          ((shownDrops.has(b.id) ? 1 : 0) - (shownDrops.has(a.id) ? 1 : 0))
          || (shareOf(a) - shareOf(b))
          || (w.indexOf(a) - w.indexOf(b)));
        const names = named.slice(0, 2).map((p) => resItem(data, p).name);
        return Object.assign(bizChip(data, x.id, {}), { sub: names.length ? 'takes ' + names.join(', ') + (w.length > names.length ? ' +' + (w.length - names.length) : '') : null });
      });
      bizListMore = Math.max(0, want.length - bizList.length);
    }
    /* THE COVERAGE FACT, SAID OUT LOUD, READ FROM coverage.USES. Not a literal:
       delete a USES row for one drop and this prints one fewer. Battle and Camp
       word it differently on purpose — they are two different questions (what
       falls in a fight vs what a unit carries home) and round 4's critic could
       not tell their cards apart. */
    if (isDrops) {
      const c = dropCoverage(data, n.id, pr.drops);
      const short = c.total - c.covered;
      if (n.id === 'sys:camp') {
        coverLine = short
          ? 'Units carry back ' + c.total + ' different resources; ' + c.covered + ' of them are wanted by a business on the map, ' + short + ' by nobody yet.'
          : 'Nothing a unit carries home is junk: every one of the ' + c.total + ' resources found out here is wanted by a business on the map.';
      } else {
        coverLine = short
          ? c.covered + ' of the ' + c.total + ' resources that drop here are wanted by a business on the map; ' + short + ' have no buyer yet.'
          : 'Every resource that drops here has a buyer: ' + c.covered + ' of ' + c.total + ' are wanted by a business on the map.';
      }
      footLine = c.covered + ' of ' + c.total + ' drops are wanted';
    } else {
      /* a making system: how much of the catalogue it accounts for */
      footLine = members.length + ' tiles · ' + pr.made.length + ' resources made between them';
      /* ROUND 6 — THE OWNER'S HEADLINE QUESTION, ASKED OF THE MAKING SYSTEMS
         TOO. "Make sure (all) of the 100+ resources that we have in the game
         has a use" was answered out loud on four of the six cards and left off
         the two systems that actually MAKE things, which said only how many
         ids they produce — a count is not an answer to "does anyone want it".
         Same helper, same coverage.USES, same property that the number falls
         when a USES row is emptied. The two systems word it differently
         because they are two different claims: a city yields, a company
         crafts — and because round 5's critic could tell Battle from Camp
         only after they stopped sharing a sentence. */
      const mc = dropCoverage(data, n.id + ':made', pr.made);
      const shortM = mc.total - mc.covered;
      if (makesAll.length) {
        coverLine = shortM
          ? mc.covered + ' of the ' + mc.total + ' resources these buildings yield are wanted by a business on the map; ' + shortM + ' are built for the city alone.'
          : 'Nothing a building here yields is decoration: all ' + mc.total + ' of those resources are wanted by a business on the map.';
      } else {
        coverLine = shortM
          ? mc.covered + ' of the ' + mc.total + ' goods crafted here have a buyer among the other tiles; ' + shortM + ' sell to players only.'
          : 'Everything crafted here has somewhere to go: all ' + mc.total + ' of these goods are wanted by another business on the map.';
      }
      /* 'built by a facility' is right for the City Builder (a building yields
         it, and `makes` carries the building's name) and wrong for Just
         Business, where a company does. Derived from which of the two the
         system's own list is, never from the system's id. */
      producesWord = makesAll.length ? 'a facility someone owns' : 'a business someone owns';
    }
  } else if (n.type === 'channel' && sellerIds.length) {
    /* what actually changes hands here: the goods the sellers make, live ones
       first so the chips are things a player can carry to the stall today */
    const goods = [], seenGood = new Set(), bringer = new Map();
    for (const sid of sellerIds) for (const m of (findNode(data, sid) || {}).makes || []) {
      if (!m || seenGood.has(m.id)) continue; seenGood.add(m.id); goods.push({ id: m.id, live: m.live === true }); bringer.set(m.id, sid);
    }
    goods.sort((a, b) => (a.live === b.live ? 0 : a.live ? -1 : 1));
    /* ROUND 6: the two counters were the near-twins Battle and Camp used to
       be — identical section labels, the same cover-sentence template, the
       same measured height and overlapping chips — so every line below that
       CAN be said in the counter's own terms is. `theme` is null for the
       general Marketplace, which keeps round 5's wording unchanged. */
    theme = channelTheme(data, n, sellerIds, goods);
    bizListLabel = theme ? 'Who brings ' + theme.noun + ' and the rest' : 'Who sells here';
    /* no 🗺 / "map" tag here: EVERY tile that sells at a channel is on the map,
       so the glyph would repeat on every chip and buy nothing but width. The
       sub instead says what THIS seller brings to THIS counter. */
    /* the seller the counter is named for leads it: the Car Dealer sat third
       behind the Oil Company and the Gas Station on the CAR Marketplace */
    const sellerOrder = theme
      ? theme.sellers.concat(sellerIds.filter((sid) => theme.sellers.indexOf(sid) < 0))
      : sellerIds;
    bizList = sellerOrder.slice(0, maxNeeds).map((sid) => {
      const seller = findNode(data, sid) || {};
      const mine = (Array.isArray(seller.makes) ? seller.makes : []);
      const live = mine.filter((m) => m.live), pick = (live.length ? live : mine).slice(0, 2).map((m) => resItem(data, m).name);
      return Object.assign(bizChip(data, sid, {}), { sub: pick.length ? 'brings ' + pick.join(', ') + (mine.length > pick.length ? ' +' + (mine.length - pick.length) : '') : null });
    });
    bizListMore = Math.max(0, sellerIds.length - bizList.length);
    if (goods.length) {
      /* spread, not the first four: seller order put the Transport company's
         packaging first and the Marketplace read like a crate depot. A spread
         over the live goods shows the stall's range (fuel, cloth, medicine…) */
      const liveGoods = goods.filter((gd) => gd.live);
      const pool = liveGoods.length >= maxMakes ? liveGoods : goods;
      /* SEED, THEN SPREAD. The goods the counter is named for are put on the
         card before the sampler runs, so the Car Marketplace can never again
         print four goods that contain no car; the remaining slots are spread
         over everything else exactly as before, so the stall still shows its
         range. At most half the slots go to the theme — a card that is four
         cars stops being a picture of a counter. */
      const seeds = [];
      if (theme) for (const gid of theme.goodIds) {
        if (seeds.length >= Math.max(1, Math.floor(maxMakes / 2))) break;
        const gd = pool.find((x) => x.id === gid) || goods.find((x) => x.id === gid);
        if (gd && seeds.indexOf(gd) < 0) seeds.push(gd);
      }
      const rest = pool.filter((gd) => seeds.indexOf(gd) < 0);
      /* ROUND 7: the rest of the counter is spread by BRINGER, so a stall with
         twenty sellers cannot show four crates off the same lorry (the Car
         Marketplace printed two goods "from Oil Company"). The seeded theme
         goods keep their place at the front. */
      const seedSellers = new Set(seeds.map((gd) => bringer.get(gd.id)).filter(Boolean));
      const pickedGoods = seeds.concat(spreadBy(rest, Math.max(0, maxMakes - seeds.length), (gd) => bringer.get(gd.id), seedSellers));
      resSampleLabel = theme ? theme.noun + ' and what sells beside them' : 'Traded here';
      const usedGoodSub = new Set();
      resSample = pickedGoods
        .map((gd) => resItem(data, gd, { sub: sameQuestionSub(data, [bringer.get(gd.id)].filter(Boolean), 'from', usedGoodSub) }));
      resSampleMore = Math.max(0, goods.length - resSample.length);
    }
    /* WHO IS SHOPPING. A counter card that names only the sellers answers half
       the question the owner asks of this map ("the best businesses to work
       with"): a player standing at the Marketplace wants to know who will take
       what they brought. coverage.USES already knows, per id, which tiles want
       it, so the buyers are a tally over the goods on this counter — nothing
       new is asserted, and a tile that wants three of them outranks one that
       wants one. It is also what keeps a channel card from being the thinnest
       thing on the map (341 px against a 385 px floor) without padding. */
    const wantTally = new Map();
    for (const gd of goods) for (const bid of wantedBy(data, gd.id)) {
      if (!wantTally.has(bid)) wantTally.set(bid, []);
      wantTally.get(bid).push(gd.id);
    }
    const ranked = Array.from(wantTally.entries()).sort((a, b) => b[1].length - a[1].length);
    if (ranked.length) {
      extraLabel = theme ? 'Who buys off this counter' : 'Who wants these goods';
      extraList = ranked.slice(0, maxNeeds).map(([bid, ids]) => {
        const names = ids.slice(0, 2).map((rid) => resItem(data, { id: rid }).name);
        return Object.assign(bizChip(data, bid, {}), { sub: 'wants ' + names.join(', ') + (ids.length > names.length ? ' +' + (ids.length - names.length) : '') });
      });
      extraMore = Math.max(0, ranked.length - extraList.length);
    }
    /* the coverage fact in the channel's own terms: a good on this counter is
       not only a player sale — read from coverage.USES, same as the systems */
    const covered = goods.filter((gd) => wantedBy(data, gd.id).length).length;
    if (theme) {
      /* the same measured fact, asked as this counter's own question — and not
         the general Marketplace's sentence with a different number in it */
      coverLine = covered === goods.length
        ? theme.noun + ' are not the only thing worth hauling here: all ' + goods.length + ' goods on this counter are wanted by a business on the map, not only by players.'
        : theme.noun + ' aside, ' + covered + ' of the ' + goods.length + ' goods here are wanted by a business on the map; the rest sell to players.';
      footLine = sellerIds.length + ' sellers · ' + theme.noun + ' and ' + Math.max(0, goods.length - theme.goodIds.length) + ' other goods';
    } else {
      coverLine = covered === goods.length
        ? 'Every one of the ' + goods.length + ' goods on this counter is wanted by a business on the map, not only by players.'
        : covered + ' of the ' + goods.length + ' goods here are wanted by a business on the map; the rest sell to players.';
      footLine = sellerIds.length + ' sellers · ' + goods.length + ' goods change hands here';
    }
  }

  let what = '';
  if (n.type === 'system') what = firstSentence(n.blurb);
  else if (n.type === 'channel') {
    /* the legend text is a label, not a sentence ("Marketplace: Best to make
       money") — close it before the count or the two run together */
    /* ROUND 6: "…Best to make money. N businesses on the map sell here." was
       the same sentence on both counters with a different N. A counter named
       after a good says how many of its sellers are in that trade, which is
       the thing a player standing in front of it wants to know. */
    const named = theme ? theme.sellers.map((sid) => nodeLabel(data, sid)) : [];
    what = endStop(firstSentence(n.blurb)) + (sellerIds.length
      ? ' ' + sellerIds.length + ' businesses on the map sell here' + (named.length ? ', ' + joinNames(named.slice(0, 2)) + ' among them.' : '.')
      : '');
  } else if (planned) {
    /* A PLANNED TILE STILL HAS A DIRECTION. Round 3 replaced `what` wholesale
       with the "does not exist yet" note, so the Fashion Brand card said only
       that — and the owner's own example (fashion -> cloth -> Transport ->
       medical) was unreadable from the Fashion end while the Medical end only
       named the brand. The note stays first (contract rule 3: never imply a
       proposal is running), then the map's intent in the map's own words. */
    const note = endStop(firstSentence(n.plannedNote) || 'On the owner\'s map only; not in the game yet.');
    const mk = makesAll.slice(0, 2).map((m) => resItem(data, m).name);
    /* a real tile before a stall: "for Medical Corporation" is the owner's
       sentence, "for the Marketplace" is where anything ends up */
    const dest = sells.slice().sort((a, b) => ((a.id.indexOf('ch:') === 0 ? 1 : 0) - (b.id.indexOf('ch:') === 0 ? 1 : 0)))
      .slice(0, 2).map((s) => s.name);
    let tail = '';
    if (mk.length && dest.length) tail = ' The map has it make ' + joinNames(mk) + ' for ' + joinNames(dest) + '.';
    else if (mk.length) tail = ' The map has it make ' + joinNames(mk) + '.';
    else if (dest.length) tail = ' The map sends what it makes to ' + joinNames(dest) + '.';
    what = note + tail;
  }
  else if (n.kind === 'hub') {
    const lanes = data.graph && Array.isArray(data.graph.lanes) ? data.graph.lanes.length : 0;
    what = 'Carries every other business\'s cargo: pickup, haul, depot, deliver.' + (lanes ? ' ' + lanes + ' lanes on the map run through it.' : '');
  } else if (n.service) what = firstSentence(n.service);
  else if (n.caption) what = firstSentence(n.caption);
  else if (n.cityOnly) what = 'Works only for the city: lets NPCs trade with other cities and camps.';
  else {
    /* "makes X today; Y on the map": the live yield first, but never hiding the
       products the owner drew the tile for (the Car Dealer's real yield is
       metal; its cars are a city-sim / proposed line). The clauses are ranked
       so the sentence sheds the city-sim aside before it sheds the map. */
    const stash = makesAll.filter((m) => makeRank(m) === 0).slice(0, 3).map((m) => resItem(data, m).name);
    const sim = makesAll.filter((m) => makeRank(m) === 1).slice(0, 2).map((m) => resItem(data, m).name);
    const wish = makesAll.filter((m) => makeRank(m) === 2).slice(0, 2).map((m) => resItem(data, m).name);
    const sells = sellsRanked(data, n).slice(0, 2).map((s) => s.label).filter(Boolean);
    const parts = [];
    if (stash.length) parts.push({ makes: true, rank: 4, text: joinNames(stash) + ' today' });
    if (sim.length) parts.push({ makes: true, rank: 1, text: joinNames(sim) + ' in the city sim' });
    if (wish.length) parts.push({ makes: true, rank: 2, text: joinNames(wish) + ' on the map' });
    if (sells.length) parts.push({ makes: false, rank: 3, text: 'sells to ' + joinNames(sells) });
    what = parts.length ? fitParts(parts, SC.hover.maxWhatChars) : 'Makes nothing the catalogue names yet.';
  }
  what = clip(what, SC.hover.maxWhatChars);

  /* counts — feature facts, never economy numbers */
  const s = n.needsSummary || null;
  /* The foot-left line. Round 4: all six system/channel cards had an EMPTY
     foot where every business card says "8 of 37 needs are live today", so the
     card that should summarise a whole system summarised nothing. A system or
     channel with needs of its own (Camp, City Builder) answers the same
     question a business does; the rest say the count that IS their summary —
     how much of the loot the map wants (Battle), how many tiles and products a
     system holds (Just Business), how big a counter is (the two channels). */
  const liveLine = (s && s.needs)
    ? (planned ? 'Every need on this tile is proposed.' : s.live + ' of ' + s.needs + ' needs are live today')
    : (footLine || null);
  /* WHAT THE "?" ON A BADGE MEANS, IN WORDS. The only explanation used to be a
     `title` on the badge, and the card is pointer-events:none by the bar's own
     rule, so a native tooltip can never open: a player saw "TRANSPORT?" with
     no way to find out why. One dim line, only on the tiles that have a doubt.
     The two doubts are different facts and must not be merged. */
  const goalOnly = badges.some((b) => b.goalOnly === true);
  const mapDoubt = badges.some((b) => b.doubt === true && b.goalOnly !== true);
  const badgeNote = goalOnly
    ? '? — no truck drawn on this tile; the written goal ships it through Transport anyway.'
    : mapDoubt ? '? — the icon sits between two tiles on the map; it may be the neighbour\'s.' : null;

  const produces = n.type === 'system' && n.produces
    ? { total: n.produces.total, made: n.produces.made.length, drops: n.produces.drops.length, word: producesWord }
    : null;

  return {
    id: n.id, known: true, type: n.type, kind: n.kind || n.type,
    name: n.label, pdfLabel: n.pdfLabel || n.label, gameName,
    kindLine, what, status, statusTag, planned,
    makes, makesMore: Math.max(0, makesAll.length - makes.length),
    lootNeeds, lootMore: Math.max(0, lootAll.length - lootNeeds.length),
    bizNeeds, bizMore: Math.max(0, bizAll.length - bizNeeds.length),
    sells, sellsMore, sellsLabel, badgeNote,
    resSample, resSampleMore, resSampleLabel,
    bizList, bizListMore, bizListLabel,
    extraList, extraMore, extraLabel,
    badges, produces, liveLine, coverLine, hint: HINT,
  };
}

/* ── the card ──────────────────────────────────────────────────────────── */

const P = SC.palette;
/* The drawn width. SC.hover.maxWidth (340) is the HARD cap — the widest the
   card may ever get on a wide screen; the card itself is drawn 20 px inside it
   so a long business name has room before the cap bites. A critic reading
   tuning.js saw 340 and measured 320 and called the knob stale, so the seam is
   asked for an explicit `SC.hover.cardWidth` (sc/decisions/hovercard.md); until
   it exists this derives it and the two numbers cannot drift. */
const CARD_W = (SC.hover && Number.isFinite(SC.hover.cardWidth) ? SC.hover.cardWidth : SC.hover.maxWidth - 20);
const CARD_CLASS = 'sc-hover';
const STYLE_ID = 'sc-hover-style';

/* Scoped under #sc-overlay (the feature's root) AND under a data attribute the
   mount sets on whatever root it is given, so a harness that mounts into a
   plain div still gets the parchment. Only this file writes `.sc-hover*`. */
const css = () => `
#sc-overlay .${CARD_CLASS}, [data-sc-hover-root] .${CARD_CLASS} {
  /* z-index is SC.hover.zIndex, NOT a literal: it has to clear .sc-head (6) or
     the card's own title is painted under the header. See tuning.js. */
  position: absolute; left: 0; top: 0; z-index: ${SC.hover.zIndex || 10};
  box-sizing: border-box;
  width: min(${CARD_W}px, calc(100vw - ${SC.hover.edgePad * 2}px));
  max-width: ${SC.hover.maxWidth}px;
  padding: 10px 12px 9px;
  color: var(--parchment-ink, ${P.parchment});
  background: var(--parchment-bg, ${P.parchmentInk});
  background-image: linear-gradient(rgba(255,255,255,.025), rgba(0,0,0,.08));
  border: 1px solid var(--gold, ${P.gold});
  box-shadow: 0 0 0 1px rgba(0,0,0,.55), inset 0 0 0 1px rgba(212,175,55,.16), 0 10px 26px rgba(0,0,0,.55);
  border-radius: 4px;
  font: 13px/1.35 'Crimson Text', 'EB Garamond', Georgia, serif;
  pointer-events: none; user-select: none;
  will-change: transform; transform: translate3d(-9999px, -9999px, 0);
  visibility: hidden;
}
#sc-overlay .${CARD_CLASS}[data-on="1"], [data-sc-hover-root] .${CARD_CLASS}[data-on="1"] { visibility: visible; }
#sc-overlay .${CARD_CLASS} *, [data-sc-hover-root] .${CARD_CLASS} * { box-sizing: border-box; min-width: 0; }
.${CARD_CLASS} .sc-hover-corner { position: absolute; width: 7px; height: 7px; border: 1px solid var(--gold, ${P.gold}); }
.${CARD_CLASS} .sc-hover-corner.tl { left: 2px; top: 2px; border-right: 0; border-bottom: 0; }
.${CARD_CLASS} .sc-hover-corner.tr { right: 2px; top: 2px; border-left: 0; border-bottom: 0; }
.${CARD_CLASS} .sc-hover-corner.bl { left: 2px; bottom: 2px; border-right: 0; border-top: 0; }
.${CARD_CLASS} .sc-hover-corner.br { right: 2px; bottom: 2px; border-left: 0; border-top: 0; }
.${CARD_CLASS} .sc-hover-title {
  font-family: 'Cinzel', Georgia, serif; font-weight: 700; font-size: 14.5px; line-height: 1.2;
  letter-spacing: .06em; text-transform: uppercase; color: var(--gold-bright, ${P.goldBright});
  margin: 0; overflow-wrap: anywhere;
}
.${CARD_CLASS} .sc-hover-kind {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 3px 0 6px; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-dim, ${P.inkDim});
}
.${CARD_CLASS} .sc-hover-chip {
  display: inline-block; padding: 1px 6px 0; border-radius: 3px; font-size: 9.5px; font-weight: 600;
  letter-spacing: .14em; line-height: 15px; border: 1px solid currentColor;
}
.${CARD_CLASS} .sc-hover-chip[data-status="live"] { color: var(--gold, ${P.gold}); }
.${CARD_CLASS} .sc-hover-chip[data-status="planned"] { color: var(--ember, ${P.ember}); border-style: dashed; }
.${CARD_CLASS} .sc-hover-chip[data-status="unknown"] { color: var(--ink-dim, ${P.inkDim}); border-style: dotted; }
.${CARD_CLASS} .sc-hover-what { margin: 0 0 7px; font-style: italic; color: var(--parchment-ink, ${P.parchment}); }
/* the measured coverage sentence: upright (it is not flavour) and gold (it is
   the answer to the owner's headline question), read from coverage.USES */
.${CARD_CLASS} .sc-hover-cover {
  margin: -2px 0 7px; font-style: normal; font-size: 12px; line-height: 1.3;
  color: var(--gold-bright, ${P.goldBright});
  border-left: 2px solid var(--gold, ${P.gold}); padding-left: 7px;
}
.${CARD_CLASS} .sc-hover-sec { margin: 0; padding: 5px 0 0; border-top: 1px solid rgba(212,175,55,.22); }
.${CARD_CLASS} .sc-hover-lbl {
  display: block; font-family: 'Cinzel', Georgia, serif; font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-dim, ${P.inkDim}); margin: 0 0 3px;
}
.${CARD_CLASS} .sc-hover-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 3px 6px; }
.${CARD_CLASS} .sc-hover-item {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 1px 6px 1px 4px; border-radius: 3px;
  background: rgba(0,0,0,.28); border: 1px solid rgba(212,175,55,.18);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* the chip's own name never shrinks (the bar: a business name is never
   truncated); the sub-line is the only elastic part, so a 27-character drop
   label ellipsises instead of pushing the card past its width */
/* ALL THE SHRINK PRESSURE ON ONE CHILD. Flexbox spreads shrink over every
   shrinkable item, so the icon, the name and the tag each gave up a pixel or
   two and — having overflow visible — drew outside their boxes: 48 chips
   measured scrollWidth > clientWidth by 2-19 px. Pinning everything except the
   sub-line to flex:none makes the sub (the only box with overflow:hidden
   and an ellipsis) absorb the whole overflow. */
.${CARD_CLASS} .sc-hover-name, .${CARD_CLASS} .sc-hover-ico,
.${CARD_CLASS} .sc-hover-tag, .${CARD_CLASS} .sc-hover-swatch { flex: none; }
.${CARD_CLASS} .sc-hover-sub {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-size: 11px; color: var(--ink-dim, ${P.inkDim}); font-style: normal;
}
/* an id the game already consumes: gold like the LIVE chip, never dimmed */
.${CARD_CLASS} .sc-hover-tag-burn { color: var(--gold, ${P.gold}); }
.${CARD_CLASS} .sc-hover-note {
  margin: 4px 0 0; font-size: 10.5px; line-height: 1.3; font-style: italic;
  color: var(--ink-dim, ${P.inkDim});
}
.${CARD_CLASS} .sc-hover-item[data-live="0"] { opacity: .72; border-style: dashed; font-style: italic; }
/* the LANE is proposed, the business is not: dashed like any proposal, but at
   full strength and upright, because the tile itself is running today */
.${CARD_CLASS} .sc-hover-item[data-route="0"][data-live="1"] { border-style: dashed; opacity: 1; font-style: normal; }
.${CARD_CLASS} .sc-hover-tag[data-kind="route"] { color: var(--ink-dim, ${P.inkDim}); }
.${CARD_CLASS} .sc-hover-item[data-themed="1"] { border-color: var(--ember, ${P.ember}); }
.${CARD_CLASS} .sc-hover-item[data-sim="1"] { opacity: .8; border-style: dotted; }
.${CARD_CLASS} .sc-hover-item[data-sim="1"] .sc-hover-tag { color: var(--ink-dim, ${P.inkDim}); }
.${CARD_CLASS} .sc-hover-ico { font-style: normal; font-size: 12px; line-height: 1; }
.${CARD_CLASS} .sc-hover-swatch { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.${CARD_CLASS} .sc-hover-more { color: var(--ink-dim, ${P.inkDim}); font-size: 11px; align-self: center; }
.${CARD_CLASS} .sc-hover-more.compact { display: none; }
.${CARD_CLASS}[data-compact="1"] .sc-hover-more.compact { display: inline; }
.${CARD_CLASS}[data-compact="1"] .sc-hover-more.full { display: none; }
.${CARD_CLASS}[data-compact="1"] .sc-hover-what { display: none; }
.${CARD_CLASS}[data-compact="1"] .sc-hover-item:nth-child(n + ${COMPACT_ITEMS + 1}) { display: none; }
/* ROUND 6: the foot SUMMARY stays on a phone — the rule that hid it is gone.
   It was hidden along with the other "second facts", but it is one line in a
   flex row that is drawn anyway (the hint sits beside it) and it is the only
   line on a compact card that summarises the whole node: "409 of 409 drops
   are wanted", "6 of 17 needs are live today". Without it the compact card is
   a title, four nouns and an invitation to click. It can wrap to a second
   line on a 320 px card, which is the right price for the card's only
   summary; the foot wraps rather than overflowing. */
.${CARD_CLASS} .sc-hover-foot { flex-wrap: wrap; }
/* compact is the phone fallback that exists so the card never covers the tile:
   the sub-lines and the badge footnote are the first things to go, because a
   chip's NAME still has to be readable and the height is what is scarce */
.${CARD_CLASS}[data-compact="1"] .sc-hover-sub, .${CARD_CLASS}[data-compact="1"] .sc-hover-note { display: none; }
.${CARD_CLASS} .sc-hover-tag { font-size: 9px; letter-spacing: .1em; color: var(--ember, ${P.ember}); font-style: normal; }
.${CARD_CLASS} .sc-hover-tag-map { color: var(--gold, ${P.gold}); }
.${CARD_CLASS} .sc-hover-item[data-map="1"] { border-color: var(--gold, ${P.gold}); background: rgba(212,175,55,.10); }
.${CARD_CLASS} .sc-hover-map { font-size: 11px; }
/* MINI: title, kind, badges, foot — for a node rect so large no side can hold
   even the compact card (a zoomed-in system tile on a phone) */
.${CARD_CLASS}[data-compact="2"] .sc-hover-what,
.${CARD_CLASS}[data-compact="2"] .sc-hover-sec,
.${CARD_CLASS}[data-compact="2"] .sc-hover-note { display: none; }
/* ROUND 6: MINI keeps the coverage sentence. It is the answer to the owner's
   headline question ("make sure all the resources have a use") and it was the
   one thing on a mini card worth the three lines it costs — the alternative
   was a title, a kind line and a hint. Clamped so a long sentence cannot turn
   the fallback card back into the tall card the fallback exists to avoid. */
.${CARD_CLASS}[data-compact="2"] .sc-hover-cover {
  font-size: 11px; margin-bottom: 4px;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
}
.${CARD_CLASS} .sc-hover-badges { display: flex; flex-wrap: wrap; gap: 4px; margin: 7px 0 0; }
.${CARD_CLASS} .sc-hover-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px 1px 5px; border-radius: 3px;
  font-family: 'Cinzel', Georgia, serif; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--gold-bright, ${P.goldBright}); border: 1px solid var(--gold, ${P.gold}); background: rgba(212,175,55,.08);
}
.${CARD_CLASS} .sc-hover-badge[data-doubt="1"] { border-style: dashed; color: var(--ink-dim, ${P.inkDim}); }
.${CARD_CLASS} .sc-hover-foot {
  display: flex; justify-content: space-between; gap: 8px; margin: 7px 0 0; padding-top: 5px;
  border-top: 1px solid rgba(212,175,55,.22); font-size: 11px; color: var(--ink-dim, ${P.inkDim});
}
.${CARD_CLASS} .sc-hover-hint { font-style: italic; white-space: nowrap; }
`;

/* COMPACT MODE. On a 390 px phone a card cannot sit beside a tile, and a
   full card (up to ~460 px tall) cannot sit above or below one in the middle
   of the screen either. Rather than cover the tile — the one thing the bar
   forbids — the card drops its sentence and shows two items per list, and is
   re-placed. It is a fallback the placement step turns on only when no clear
   side fits at full size, so desktop never sees it. */
const COMPACT_ITEMS = 2;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
};

function itemEl(it, opts) {
  const li = el('li', 'sc-hover-item');
  li.dataset.live = it.live ? '1' : '0';
  if (it.route === false) li.dataset.route = '0';   // the LANE is the owner's drawing, not the tile
  if (it.themed) li.dataset.themed = '1';
  /* a business chip brings its own sentence (bizChip) because "planned" there
     means something else than it does on a resource chip */
  li.title = it.title || (it.name + (it.live ? '' : ' (planned)'));
  if (!it.title && it.sharedWith > 0) li.title += ' — also a need of ' + it.sharedWith + ' other ' + (it.sharedWith === 1 ? 'business' : 'businesses') + ' on the map';
  if (it.icon) li.appendChild(el('i', 'sc-hover-ico', it.icon));
  else if (it.color) { const sw = el('i', 'sc-hover-swatch'); sw.style.background = it.color; li.appendChild(sw); }
  li.appendChild(el('span', 'sc-hover-name', it.name));
  /* THE SECOND FACT, DRAWN. The view-model has always known what rides a lane
     (`cargo`) and where a drop is found (`where`); round 3 rendered neither
     and left both to a `title`, which a pointer-events:none card can never
     show. The sub-line is the only shrinkable part of the chip, so a long
     drop label ellipsises while the business name stays whole (the bar). */
  if (it.sub) li.appendChild(el('span', 'sc-hover-sub', '· ' + it.sub));
  /* drawn on the owner's PDF: the glyph goes FIRST so the eye finds the map's
     own dependencies before it reads the derived ones, and the tag repeats it
     in words for anyone who cannot read a tiny glyph */
  if (it.onMap) { li.dataset.map = '1'; li.insertBefore(el('i', 'sc-hover-ico sc-hover-map', '🗺'), li.firstChild); }
  /* an explicit tag from the view-model wins: it is the only place that knows
     whether the word is about the node or about the lane */
  if (it.tag && it.tag.text) {
    const t = el('span', 'sc-hover-tag' + (it.tag.kind === 'map' ? ' sc-hover-tag-map' : ''), it.tag.text);
    t.dataset.kind = it.tag.kind || '';
    li.appendChild(t);
  /* the game takes this off you TODAY (n.upkeep: an OPS_ECON input or a
     sub-screen bench recipe). It outranks "planned" because it is the one
     thing on the chip that is not a proposal. */
  } else if (it.burns) {
    const t = el('span', 'sc-hover-tag sc-hover-tag-burn', it.burns === 'ops' ? 'burns' : 'bench');
    t.dataset.kind = 'burns'; li.appendChild(t);
    /* ⚠ ROUND NINE — THE CITE MUST NOT RIDE IN THE TOOLTIP.
       This line appended `it.burnsCite` unconditionally, so 15 tooltips on 11
       tiles read e.g. "Metal — an input this operation burns every tick today
       (OPS_ECON (public/index.html), read through _opEcon() cars.inputs.metal)"
       to every player who rested the cursor there. modal.js had exactly this bug
       and fixed it by putting the cite behind the admin gate; the hover card has
       no admin flag to gate on (hoverVM takes none, and adding one would make a
       pure VM depend on the shell), and a tooltip is the one surface no
       screenshot check can see — which is why this sat unnoticed for eight
       rounds. So the tooltip is the SENTENCE ONLY. `burnsCite` stays on the VM
       for auditors and the ore gate; no view reads it, the same rule recipes.js
       settled on for `evidence`. */
    li.title = it.name + ' — ' + (it.burns === 'ops' ? 'an input this operation burns every tick today' : 'consumed by this business\'s own bench recipe today');
  } else if (opts && opts.tagPlanned && !it.live) li.appendChild(el('span', 'sc-hover-tag', 'planned'));
  /* a yield of the simulated city firm, never a player stash (recipes.js ECO):
     live in the sim, so not "planned", but not something you can haul either */
  else if (it.via === 'cityFirm') { li.dataset.sim = '1'; li.appendChild(el('span', 'sc-hover-tag', 'city sim')); }
  else if (it.onMap) li.appendChild(el('span', 'sc-hover-tag sc-hover-tag-map', 'map'));
  return li;
}

function section(label, items, more, opts) {
  if (!items.length) return null;
  const sec = el('div', 'sc-hover-sec');
  sec.appendChild(el('span', 'sc-hover-lbl', label));
  const ul = el('ul', 'sc-hover-list');
  for (const it of items) ul.appendChild(itemEl(it, opts));
  /* two counters, CSS shows one: compact mode hides every item past the
     second, so its "+N more" must count those too or the card under-reports */
  const hiddenInCompact = Math.max(0, items.length - COMPACT_ITEMS);
  if (more > 0) ul.appendChild(el('li', 'sc-hover-more full', '+' + more + ' more'));
  if (more + hiddenInCompact > 0) ul.appendChild(el('li', 'sc-hover-more compact', '+' + (more + hiddenInCompact) + ' more'));
  sec.appendChild(ul);
  return sec;
}

function render(card, vm) {
  card.textContent = '';
  for (const c of ['tl', 'tr', 'bl', 'br']) card.appendChild(el('i', 'sc-hover-corner ' + c));
  card.appendChild(el('h4', 'sc-hover-title', vm.name));
  const kind = el('div', 'sc-hover-kind');
  const chip = el('span', 'sc-hover-chip', vm.statusTag); chip.dataset.status = vm.status;
  kind.appendChild(chip);
  kind.appendChild(el('span', null, vm.kindLine));
  card.appendChild(kind);
  if (vm.what) card.appendChild(el('p', 'sc-hover-what', vm.what));
  /* THE COVERAGE SENTENCE, on its own paragraph. It cannot ride inside `what`:
     that string is clipped to SC.hover.maxWhatChars (a glance-length blurb) and
     the sentence would be the part thrown away. Upright and gold-ish, not
     italic like the blurb — it is a measured fact, not flavour text. */
  if (vm.coverLine) card.appendChild(el('p', 'sc-hover-cover', vm.coverLine));

  const makes = section('Makes', vm.makes, vm.makesMore, { tagPlanned: true });
  if (makes) card.appendChild(makes);
  if (vm.produces) {
    const sec = el('div', 'sc-hover-sec');
    sec.appendChild(el('span', 'sc-hover-lbl', 'Produces'));
    /* "Produces 409 resources: 0 made" read as a data bug; say what the count
       IS — a system does not manufacture, its ruins and fallen units drop */
    const pr = vm.produces;
    const txt = pr.made === 0 ? pr.drops + ' resources drop here as loot; none are manufactured'
      : pr.drops === 0 ? pr.made + ' resources, every one of them built by ' + (pr.word || 'a facility someone owns')
        : pr.total + ' resources: ' + pr.made + ' made by its facilities, ' + pr.drops + ' found as loot';
    sec.appendChild(el('span', null, txt));
    card.appendChild(sec);
  }
  /* a system's / channel's own chips — the four nodes that had none in round 2 */
  if (vm.resSample && vm.resSample.length) {
    const s = section(vm.resSampleLabel, vm.resSample, vm.resSampleMore, { tagPlanned: true });
    if (s) card.appendChild(s);
  }
  if (vm.bizList && vm.bizList.length) {
    const s = section(vm.bizListLabel, vm.bizList, vm.bizListMore, {});
    if (s) card.appendChild(s);
  }
  /* the channels' third list: who is shopping at this counter */
  if (vm.extraList && vm.extraList.length) {
    const s = section(vm.extraLabel, vm.extraList, vm.extraMore, {});
    if (s) card.appendChild(s);
  }
  /* the outbound half, before the inbound half: a player reads the tile's
     product, then where it goes, then what it has to buy to make it */
  if (vm.sells && vm.sells.length) {
    const s = section(vm.sellsLabel, vm.sells, vm.sellsMore, {});
    if (s) card.appendChild(s);
  }
  const loot = section('Needs from battle loot', vm.lootNeeds, vm.lootMore, { tagPlanned: true });
  if (loot) card.appendChild(loot);
  if (vm.bizNeeds.length) {
    const items = vm.bizNeeds;
    const anyMap = items.some((b) => b.onMap);
    /* the legend for the 🗺 glyph, kept to ONE line: "drawn on the map" measured
       300 px against 294 px of inner width, so every business card spent a whole
       extra line on a wrapped "MAP" (round-2 screenshots). "on the map" is 253. */
    card.appendChild(section(anyMap ? 'Needs from businesses · 🗺 on the map' : 'Needs from businesses', items, vm.bizMore, { tagPlanned: true }));
  }
  if (vm.badges.length) {
    const row = el('div', 'sc-hover-badges');
    for (const b of vm.badges) {
      const x = el('span', 'sc-hover-badge');
      x.dataset.key = b.key; x.dataset.doubt = b.doubt ? '1' : '0'; x.title = b.meaning + (b.doubt ? ' (uncertain on the map)' : '');
      x.appendChild(el('i', 'sc-hover-ico', b.glyph)); x.appendChild(el('span', null, b.label + (b.doubt ? '?' : '')));
      row.appendChild(x);
    }
    card.appendChild(row);
    if (vm.badgeNote) card.appendChild(el('p', 'sc-hover-note', vm.badgeNote));
  }
  const foot = el('div', 'sc-hover-foot');
  foot.appendChild(el('span', null, vm.liveLine || (vm.planned ? 'On the owner\'s map only' : '')));
  foot.appendChild(el('span', 'sc-hover-hint', vm.hint));
  card.appendChild(foot);
}

/* Where to put a w x h card so it sits beside `avoid` (the node's rect, or a
   small square around the pointer), never covers it, and stays inside `box`.
   Tries the four sides in reading order, then falls back to the candidate that
   overlaps the node least once clamped — a 390 px screen can be too narrow
   for a card to sit beside a wide tile, and "least overlap" beats "off-screen". */
function place(w, h, avoid, box, pad, ox, oy) {
  const cands = [
    { x: avoid.right + ox, y: avoid.top },              // right of it
    { x: avoid.left - ox - w, y: avoid.top },           // left of it
    { x: avoid.left, y: avoid.bottom + oy },            // below it
    { x: avoid.left, y: avoid.top - oy - h },           // above it
    { x: avoid.right + ox, y: avoid.bottom - h },       // right, bottom-aligned
    { x: avoid.left - ox - w, y: avoid.bottom - h },    // left, bottom-aligned
  ];
  const minX = box.left + pad, minY = box.top + pad;
  const maxX = Math.max(minX, box.right - pad - w), maxY = Math.max(minY, box.bottom - pad - h);
  const clamp = (c) => ({ x: Math.min(maxX, Math.max(minX, c.x)), y: Math.min(maxY, Math.max(minY, c.y)) });
  const overlap = (c) => {
    const dx = Math.min(c.x + w, avoid.right) - Math.max(c.x, avoid.left);
    const dy = Math.min(c.y + h, avoid.bottom) - Math.max(c.y, avoid.top);
    return dx > 0 && dy > 0 ? dx * dy : 0;
  };
  /* A clamped candidate is fine (a corner node's card nudged in by the edge
     pad); an OVERLAPPING one is not. The caller only reacts to `overlap`. */
  let best = null;
  for (const raw of cands) {
    const c = clamp(raw);
    const clamped = c.x === raw.x && c.y === raw.y ? 0 : 1;
    const ov = overlap(c);
    if (ov === 0 && clamped === 0) return { x: c.x, y: c.y, overlap: 0, clamped: 0 };
    const score = ov * 4 + clamped;
    if (!best || score < best.score) best = { x: c.x, y: c.y, overlap: ov, clamped, score };
  }
  return best;
}

/**
 * mountHover(root) -> { show(vm, xy), hide(), dispose(), el }
 *   xy = {x, y} client coordinates of the pointer (an [x, y] pair also works),
 *        optionally with `rect` = the hovered node's client rect {left, top,
 *        right, bottom} (or {x, y, w, h}); the card then keeps off the node.
 *   The card is a child of `root` (the overlay). `root` should be positioned;
 *   coordinates are converted from client space to root space on every show
 *   (one rect read), so a scrolled or offset root still places correctly.
 */
export function mountHover(root) {
  const host = root && root.nodeType === 1 ? root : document.body;
  if (!host.hasAttribute('data-sc-hover-root')) host.setAttribute('data-sc-hover-root', '1');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  let style = document.getElementById(STYLE_ID);
  let ownsStyle = false;
  if (!style) { style = el('style'); style.id = STYLE_ID; style.textContent = css(); document.head.appendChild(style); ownsStyle = true; }

  const card = el('div', CARD_CLASS);
  card.id = 'sc-hover';
  card.setAttribute('role', 'tooltip');
  card.setAttribute('aria-hidden', 'true');
  card.dataset.on = '0';
  host.appendChild(card);

  let lastId = null, dead = false, last = null, wLast = 0, hLast = 0;

  const api = {
    el: card,
    show(vm, xy) {
      if (dead || !vm) return;
      /* re-render only when the node changes: a pointermove across one tile
         fires dozens of shows and rebuilding the DOM each time is the thrash
         the bar forbids */
      if (vm.id !== lastId || !card.childNodes.length) { render(card, vm); lastId = vm.id; card.dataset.node = String(vm.id); card.dataset.status = vm.status; card.dataset.compact = '0'; }
      const p = Array.isArray(xy) ? { x: xy[0], y: xy[1] } : (xy || {});
      const px = Number.isFinite(p.x) ? p.x : 0, py = Number.isFinite(p.y) ? p.y : 0;
      let r = p.rect || null;
      if (r && typeof r === 'object' && !('right' in r)) r = { left: r.x || r.left || 0, top: r.y || r.top || 0, right: (r.x || r.left || 0) + (r.w || r.width || 0), bottom: (r.y || r.top || 0) + (r.h || r.height || 0) };
      /* the thing to keep clear of: the node's rect if given, else a small square
         around the pointer so the card is never under the cursor */
      const avoid = r ? { left: Math.min(r.left, px), top: Math.min(r.top, py), right: Math.max(r.right, px), bottom: Math.max(r.bottom, py) }
        : { left: px - 6, top: py - 6, right: px + 6, bottom: py + 6 };

      card.dataset.on = '1';
      card.setAttribute('aria-hidden', 'false');
      /* ONE layout read (card size + host rect) after the DOM write, then one
         transform write. The card is sized by CSS, so its size does not depend
         on the position we are about to set. */
      const hb = host.getBoundingClientRect();
      const w = card.offsetWidth, h = card.offsetHeight;
      const vw = typeof window !== 'undefined' ? window.innerWidth : hb.right;
      const vh = typeof window !== 'undefined' ? window.innerHeight : hb.bottom;
      /* bounds = the host clipped to the viewport: an overlay taller than the
         screen must not place a card in its off-screen part */
      const box = { left: Math.max(hb.left, 0), top: Math.max(hb.top, 0), right: Math.min(hb.right, vw), bottom: Math.min(hb.bottom, vh) };
      const pad = SC.hover.edgePad, ox = SC.hover.offsetX, oy = SC.hover.offsetY;
      let c = place(w, h, avoid, box, pad, ox, oy);
      wLast = w; hLast = h;
      /* No clear side at full size: shrink and try again (one extra layout
         read per step, only on the small screens that need it). Compact hides
         the sentence and trims the lists; MINI keeps only title, kind, badges
         and the hint. The level sticks for this node so the next pointermove
         does not flip it back. Levels only go up within one node. */
      const levels = [['1', 'compact'], ['2', 'mini']];
      const startAt = card.dataset.compact === '2' ? 2 : card.dataset.compact === '1' ? 1 : 0;
      let mode = startAt ? levels[startAt - 1][1] : 'full';
      for (let i = startAt; c.overlap > 0 && i < levels.length; i++) {
        card.dataset.compact = levels[i][0];
        const w2 = card.offsetWidth, h2 = card.offsetHeight;
        c = place(w2, h2, avoid, box, pad, ox, oy);
        wLast = w2; hLast = h2; mode = levels[i][1];
      }
      /* Still overlapping: the node is bigger than any free side of the screen
         (a hub tile zoomed to fill a phone). Nothing can avoid THAT rect, so
         the rule falls back to the one the bar cares about most — never under
         the pointer — with a wide keep-out square so the card sits clearly
         beside the finger, not touching it. `overlap` in `last` still reports
         the node overlap honestly for tests. */
      let pointerOnly = false;
      if (c.overlap > 0 && r) {
        const keep = Math.max(ox, oy) + 6;
        const ptr = { left: px - keep, top: py - keep, right: px + keep, bottom: py + keep };
        const c2 = place(wLast, hLast, ptr, box, pad, ox, oy);
        const ov = (a) => Math.max(0, Math.min(a.x + wLast, avoid.right) - Math.max(a.x, avoid.left)) * Math.max(0, Math.min(a.y + hLast, avoid.bottom) - Math.max(a.y, avoid.top));
        if (c2.overlap === 0) { c = { x: c2.x, y: c2.y, overlap: ov(c2), clamped: c2.clamped }; pointerOnly = true; }
      }
      const x = Math.round(c.x - hb.left), y = Math.round(c.y - hb.top);
      card.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      last = { x: c.x, y: c.y, w: wLast, h: hLast, overlap: c.overlap || 0, clamped: c.clamped || 0, compact: card.dataset.compact !== '0', mode, pointerOnly };
    },
    hide() {
      if (dead) return;
      card.dataset.on = '0';
      card.setAttribute('aria-hidden', 'true');
      card.style.transform = 'translate3d(-9999px,-9999px,0)';
      last = null;
    },
    /* the last placement in client coordinates — for tests, not for views */
    placement: () => last,
    visible: () => !dead && card.dataset.on === '1',
    dispose() {
      if (dead) return;
      dead = true;
      try { card.remove(); } catch (_) { /* already gone */ }
      if (ownsStyle) { try { style.remove(); } catch (_) { /* already gone */ } }
      try { host.removeAttribute('data-sc-hover-root'); } catch (_) { /* detached */ }
      lastId = null; last = null;
    },
  };
  return api;
}

export const HOVER_BADGES = BADGES;
export default mountHover;
