/* ══════════════════════════════════════════════════════════════════════════
   🔍 DRIVE-SEARCH-COST — search the deck BY COST, without listing every card.

   Reported: "Have it where I can select the cost, if it's higher/greater or
   equal, and it will search for that cost card, instead of having to put every
   card that the card can search for."

   🔴 THE ENGINE ALREADY DOES THIS, AND THAT IS THE FINDING. The shared Card
      Filter carries { cost, costMode: 'exact' | 'min' | 'max' } and
      _cardMatchesFilter honours all three; searchDeck passes eff.filter
      straight into the pool. So "any card costing 4 or less" is expressible
      today with an EMPTY allow-list.
      What was missing was any way to know that: the Search Deck section's own
      help text said the Card Filter narrows by "element/faction/name" and did
      not mention cost at all, while the card PICKER sitting right above it has
      its own "Cost ≤" control that only filters the browse list. Two cost
      boxes, one of which does the thing, and the label pointed at the other.

   ⚠ SO THIS DRIVER EXISTS TO PROVE THE CLAIM BEFORE THE LABEL PROMISES IT.
     Asserting the fix is a wording change is only honest if the underlying
     behaviour is measured, with an empty allow-list, on a real deck.

   Run:  node .gauntlet/drive-search-cost.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9760 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.src = {
    /* the three modes exist in the matcher */
    matcherHasModes: /const mode = f\.costMode \|\| 'exact';/.test(idx)
      && /mode === 'min' && c < want/.test(idx) && /mode === 'max' && c > want/.test(idx),
    /* the editor offers them in words a designer can read */
    editorOffersModes: /\['exact','exactly'\],\['min','at least'\],\['max','at most'\]/.test(idx),
    /* searchDeck actually forwards the filter, and counts `cost` as a set key */
    searchForwardsFilter: /_openDeckSearchModal\(wantType, cardIds, unit\.name \|\| 'Unit', 'hand', 1, 'deck', _sdFilter, _sdCostDelta\)/.test(idx),
    searchCountsCostAsSet: /\['element', 'faction', 'cardType', 'cost', 'nameIncludes'\]\.some/.test(idx),
    /* 🔴 THE FIX ITSELF: the Search Deck help now (a) says you need not list
       every card, (b) names COST among what the Card Filter narrows by, (c)
       gives the at-most/at-least/exactly wording the editor actually shows, and
       (d) says which of the two cost boxes on that screen is the rule and which
       only filters the browse list. All four, because leaving any one out is
       how the original text managed to be accurate and still useless. */
    helpMentionsCost: /You do not have to list every card/.test(idx)
      && /element, faction, type, name and COST/.test(idx)
      && /at most<\/em> \/ <em>at least<\/em> \/ <em>exactly/.test(idx)
      && /only filters this browse list/.test(idx),
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

out.match = await pg.evaluate(() => {
  const o = {};
  const mk = (name, cost) => ({ id: 'c' + cost + name, name, cost, type: 'unit', element: 'fire' });
  const deck = [mk('One', 1), mk('Three', 3), mk('Four', 4), mk('Five', 5), mk('Nine', 9)];
  const pick = (f) => deck.filter(c => _cardMatchesFilter(c, f, 'deck')).map(c => c.cost).sort((a, b) => a - b);

  /* 🔴 THE THREE OPERATORS THE REQUEST NAMES */
  o.atMost4  = pick({ cost: 4, costMode: 'max' });     // "4 or less"
  o.atLeast4 = pick({ cost: 4, costMode: 'min' });     // "4 or more"
  o.exactly4 = pick({ cost: 4, costMode: 'exact' });   // "exactly 4"
  /* CONTROL: no cost set → the filter must not narrow by cost at all */
  o.noCost   = pick({ element: 'fire' });
  /* CONTROL: cost 0 is a real value, not "unset" — a 0-cost search must work */
  o.zeroIsReal = _cardMatchesFilter(mk('Zero', 0), { cost: 0, costMode: 'exact' }, 'deck');
  o.zeroExcludesOthers = !_cardMatchesFilter(mk('Three', 3), { cost: 0, costMode: 'exact' }, 'deck');

  /* 🔴 …AND THE SEARCH ITSELF HONOURS IT WITH AN EMPTY ALLOW-LIST, which is the
     whole point: no chips, just a rule. _aiDeckSearchPick is the deterministic
     half of searchDeck and takes the same (type, cardIds, filter) triple the
     modal does. */
  try {
    const side = { deck: deck.slice(), hand: [], graveyard: [] };
    const got = _aiDeckSearchPick(side, 'any', null, { cost: 4, costMode: 'max' }, 0);
    o.searchPicked = !!got;
    o.searchPickedCost = got ? (got.hand[got.hand.length - 1] || {}).cost : null;
    const side2 = { deck: deck.slice(), hand: [], graveyard: [] };
    const got2 = _aiDeckSearchPick(side2, 'any', null, { cost: 5, costMode: 'min' }, 0);
    o.minPickedCost = got2 ? (got2.hand[got2.hand.length - 1] || {}).cost : null;
    /* CONTROL: a rule nothing satisfies must find nothing rather than anything */
    const side3 = { deck: deck.slice(), hand: [], graveyard: [] };
    o.impossibleFindsNothing = !_aiDeckSearchPick(side3, 'any', null, { cost: 99, costMode: 'min' }, 0);
  } catch (e) { o.searchErr = String(e).slice(0, 180); }
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.src, X = out.match || {};

need('the matcher implements exact / at-least / at-most', S.matcherHasModes === true, S);
need('the editor offers all three in words', S.editorOffersModes === true, S);
need('searchDeck forwards the shared filter', S.searchForwardsFilter === true, S);
need('…and treats a set cost as a reason to apply it', S.searchCountsCostAsSet === true, S);
need('🔴 THE FIX: the Search Deck help now names COST, and says which box is the rule',
     S.helpMentionsCost === true, S);

need('🔴 THE ASK: "cost 4 or less" matches 1, 3, 4 and nothing dearer',
     JSON.stringify(X.atMost4) === JSON.stringify([1, 3, 4]), X.atMost4);
need('🔴 THE ASK: "cost 4 or more" matches 4, 5, 9',
     JSON.stringify(X.atLeast4) === JSON.stringify([4, 5, 9]), X.atLeast4);
need('…and "exactly 4" matches only 4', JSON.stringify(X.exactly4) === JSON.stringify([4]), X.exactly4);
need('CONTROL: with no cost set the filter narrows nothing by cost',
     JSON.stringify(X.noCost) === JSON.stringify([1, 3, 4, 5, 9]), X.noCost);
need('CONTROL: cost 0 is a real value, not "unset"',
     X.zeroIsReal === true && X.zeroExcludesOthers === true, X);

need('🔴 THE POINT: the search runs off the RULE with an EMPTY allow-list',
     X.searchPicked === true, X);
need('…and what it fetched obeys the rule', X.searchPickedCost <= 4, X);
need('…and "at least 5" fetches something dearer', X.minPickedCost >= 5, X);
need('CONTROL: a rule nothing satisfies finds NOTHING, not anything',
     X.impossibleFindsNothing === true, X);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — a cost rule searches the deck with no allow-list at all.');
