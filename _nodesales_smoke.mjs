/* 🏷 NODES FOR SALE + MORE THAN ONE CITY (v121v56, sql/118).

   Asked for: "players who own more than one node can build more than one
   city and assign multiple mayors; a For Sale button that puts a sign on
   the node, lets the owner set the price and write what it comes with,
   shows the Cinder price and its USD worth; a note that Hidn Studios holds
   all sales in escrow until payment has been fully transferred between
   players and ownership."

   Defends:
     · sql/118: one listing per node, owner-only list / cancel, a purchase
       that takes escrow, moves ownership, ends the mayor contract, moves the
       city when included, then releases escrow — one transaction; RLS on;
     · the client: listings ride with the owners fetch, the map shows the
       FOR SALE sign, the drawer shows sell / change / take-down to the owner
       and price + USD + includes + details + escrow note + Buy to others;
       the sale form computes USD live from the exchange's own rate;
     · more than one city: an owner clicking a node they own is never bounced
       to their home city; the button reads "Start Your … City" there;
     · the escrow note text is present verbatim in the drawer, the form and
       the purchase confirm.

   Run: node _nodesales_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/118_node_sales.sql', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── sql/118 ── */
ok(/create table if not exists public\.node_sales \(\n\s*node_id\s+text primary key/.test(SQL), 'one listing per node');
ok(/price\s+bigint not null check \(price > 0 and price <= 2000000000\)/.test(SQL), 'a price is positive and capped');
['node_sale_list', 'node_sale_cancel', 'node_sale_buy'].forEach((f) => ok(new RegExp('create or replace function public\\.' + f + '\\(').test(SQL) && new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\) to authenticated').test(SQL), f + ' exists and is granted'));
ok(/only the owner of this node can put it up for sale/.test(SQL), 'only the owner lists');
ok(/you cannot buy your own node/.test(SQL), 'no self-purchase');
const buy = SQL.slice(SQL.indexOf('function public.node_sale_buy('), SQL.indexOf('revoke all on function public.node_sale_buy'));
const iTake = buy.indexOf('_ct_cinder_take(v_uid, v_row.price'), iOwn = buy.indexOf('update public.tw_node_owners set user_id = v_uid'), iMayor = buy.indexOf('update public.node_mayors set active = false'), iCity = buy.indexOf("(v_row.includes->>'city')::boolean"), iGive = buy.indexOf('_ct_cinder_give(v_row.seller_id, v_row.price');
ok(iTake > 0 && iOwn > iTake && iMayor > iOwn && iCity > iMayor && iGive > iCity, 'purchase order: escrow in → ownership → mayor ended → city moved → escrow released, one transaction');
ok(/held in escrow by Hidn Studios/.test(buy) && /escrow released by Hidn Studios/.test(buy), 'both ledger rows name Hidn Studios escrow');
ok(/the seller no longer owns this node/.test(buy), 'a stale listing cannot sell a node the seller lost');
ok(/enable row level security/.test(SQL) && /revoke insert, update, delete on public\.node_sales, public\.node_sale_log from authenticated, anon/.test(SQL), 'RLS on, no direct writes');
/* 🔒 Supabase's default privileges grant EXECUTE to `anon` as a SECOND ACL entry;
   `from public` alone leaves it standing (verified live on 2026-09-06). */
ok((SQL.match(/^revoke all on function [^\n;]*? from public, anon;$/gm) || []).length === 3 && !/ from public;$/m.test(SQL), 'every function revoke names anon as well as public');

/* ── client ── */
ok(/const NODE_SALE_ESCROW_NOTE = 'Hidn Studios holds every node sale in escrow: the buyer\\'s Cinder is held by Hidn Studios until payment has been fully transferred between players and ownership of the node has moved to the buyer\./.test(SRC), 'the escrow note is verbatim');
ok(/try \{ tw_fetchNodeSales\(\); \} catch \(e\) \{\}/.test(SRC), 'listings ride with the owners fetch');
ok(/_twNodeSale\(n\.id\)\) \? '<div class="tw-nm2-sale" title="This node is for sale">FOR SALE<\/div>' : ''/.test(SRC), 'the map shows a FOR SALE sign on a listed node');
ok(/\$\{\(typeof _twSaleSectionHtml === 'function'\) \? _twSaleSectionHtml\(selNode\) : ''\}/.test(SRC), 'the drawer carries the sale card');
const sec = fnText('_twSaleSectionHtml');
ok(/List for Sale/.test(sec) && /Change price \/ details/.test(sec) && /Take the sign down/.test(sec) && /Buy for 🔥/.test(sec), 'owner: List for Sale / change / take down; visitor: Buy');
/* v121v71 moved the owner test into a named local so an UNREAD owners table
   stops being read as "not yours" (that silent hide is what "I cannot find the
   sell node button" was). The property asserted here is unchanged: the button
   is the owner's, and a mayor standing in a client's city never gets it. */
ok(/sl\.id = 'node-city-sell';/.test(SRC) && /'🏷 FOR SALE · EDIT' : '🏷 LIST FOR SALE'/.test(SRC) && /sl\.onclick = \(\) => \{ try \{ _twSellNode\(_nid\); \}/.test(SRC) && /_ownerHere === _me/.test(SRC) && /!App\._cityOwnerId/.test(SRC), 'the city builder host bar carries List for Sale for the owner only');
{ const NC = readFileSync('./public/node-city/index.html', 'utf8'); ok(!/animation:warnpulse 1s infinite/.test(NC) && !/animation: rlpulse 1s infinite/.test(NC) && /rlpulse 1\.6s ease-in-out 3/.test(NC), 'no launcher, card or pill flashes forever — three slow pulses then a held glow'); }
ok(/≈ \$\{escapeHtml\(usd\)\} USD/.test(sec) && /_twSaleIncludesHtml\(inc\)/.test(sec) && /tw-sale-escrow/.test(sec), 'the card shows Cinder, USD, what is included, details and the escrow note');
const sell = fnText('_twSellNode');
ok(/rpc\('node_sale_list'/.test(sell) && /price\.oninput = \(\) => \{ usd\.textContent = '≈ ' \+ _twSaleUsd/.test(sell) && /NODE_SALE_INCLUDES\.map/.test(sell), 'the form lists through the RPC, computes USD live, and offers every include');
const buyc = fnText('_twBuyNode');
ok(/rpc\('node_sale_buy'/.test(buyc) && /gcConfirm\(/.test(buyc) && /NODE_SALE_ESCROW_NOTE\)/.test(buyc) && /tw_cloudFetchNodeOwners\(\)/.test(buyc), 'Buy confirms with the escrow note, calls the RPC, and refreshes ownership');
ok(/Profile\.gems = Math\.max\(0, d\.buyer_balance \| 0\)/.test(buyc) && /Profile\.walletSeqProgress = d\.buyer_wallet_seq \| 0/.test(buyc), 'the buyer adopts the server balance and seq');
/* USD from the exchange's own rate */
{
  const ctx = { DVS_CINDER_PER_USD: 5000 }; vm.createContext(ctx); vm.runInContext(fnText('_dvsUsd'), ctx);
  ok(vm.runInContext("_dvsUsd(250000)", ctx) === '$50.00', '250,000 🔥 reads as $50.00');
}
/* more than one city */
ok(/const home = own\.has\(String\(_nodeKey\)\) \? null : \(mine\.data \|\| \[\]\)/.test(SRC), 'an owner opening a node they own starts a city there instead of being bounced home');
ok(/const _hasCityHere = !Array\.isArray\(App\._myCityNodes\) \|\| App\._myCityNodes\.indexOf\(String\(selNode\.id\)\) >= 0;/.test(SRC) && /'🏗 Start Your '/.test(SRC), 'the drawer says Start Your … City on an owned node with no city yet');
ok(/window\.__mg\._twSellNode = _twSellNode; window\.__mg\._twCancelSale = _twCancelSale; window\.__mg\._twBuyNode = _twBuyNode;/.test(SRC), 'seams on __mg');
ok(/window\.BUILD_VERSION = 'v121v(5[6-9]|[6-9]\d|\d{3,})'/.test(SRC), 'build v121v56 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
