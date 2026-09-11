/* 🐄🌾 THE TRUCK YARD GREW TWO CARGO CLASSES AND LEARNED TO SHOW THE TRUCK.

   Asked for: "In Prince port in the truck yard add two new truck type Bulk
   Feeding trucks and Animal transport trucks and make sure to show 3d models of
   the trucks in view mode."

   TWO THINGS HAD TO BE TRUE AND NEITHER WAS FREE.

   1. THE YARD COUNTED CLASSES WITH `=== 'oil'`. Six sites in index.html were
      written as two-way branches — the class reader, the tab counts, the
      empty-tab fallback, the TABS literal, the tab click, the empty-tab
      sentence — plus a stocker that took its class list from the FLOOR DEPTH
      map. Adding rows to rigs.data.js alone would have produced trucks that
      roll, price and sell correctly and are invisible: every feed and livestock
      rig answering 'freight', filed under the freight tab, with two tabs that
      never appear and a floor that never stocks them. This suite pins that
      every one of those reads is now derived from the module's class list.

   2. NOTHING RENDERED A MODEL FOR A RIG. `modelUrl` is stamped per-row by the
      CAR auction from an admin upload; a rig has no such row field, so all
      three vehicle modals printed "[VEHICLE PHOTO · drop a 3/4 render]" over
      every truck in the game. And the two surfaces that would have shown one —
      the yard card and the listing modal — had no _ppaFillThumbs call at all,
      so marking the element up would still have left it on "rendering 3D…"
      forever, under a caption promising a click-to-orbit that was never bound.

   THE INVARIANT THIS SUITE EXISTS FOR: a rig's model is resolved from the
   CATALOGUE at render time, never stamped onto a saved row — so a truck bought
   before models existed still shows one — and every model path a rig claims is
   both on disk and re-included in .assetsignore, because the blanket ignore
   makes a missing line work perfectly in dev and 404 only in production.

   Run: node _rigyard_smoke.mjs */
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';
import { auditRigs, PP_RIGS, CARGO_CLASSES, cargoClassOf, cargoClassIds } from './public/src/transport/rigs.data.js';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');
const IGN = readFileSync('./public/.assetsignore', 'utf8');

function fnText(name, src = IDX) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function litOf(name, open) {
  const i = IDX.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = IDX.indexOf(open, i); k < IDX.length; k++) {
    if (IDX[k] === open) d++;
    else if (IDX[k] === close) { d--; if (!d) return IDX.slice(IDX.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* ── 1. THE DATA, AUDITED AGAINST index.html's OWN TABLES ─────────────────── */
{
  const RARITIES = vm.runInNewContext('(' + litOf('RARITIES', '[') + ')').map(r => r.id);
  const COND = vm.runInNewContext('(' + litOf('PP_COND_MULT', '{') + ')');
  /* The module's own audit, fed the real upstream tables rather than its
     mirrors — which is the only configuration in which its drift alarm and its
     rarity-count rule are actually checking anything. */
  const probs = auditRigs(RARITIES, COND);
  ok(probs.length === 0, 'auditRigs() is clean against the real rarity ladder and PP_COND_MULT', probs.join(' | '));
}

/* ── 2. THE TWO NEW CLASSES EXIST AND ARE SEPARATE ────────────────────────── */
{
  const ids = cargoClassIds();
  ok(ids.length === 4, 'four cargo classes', ids.join(','));
  for (const id of ['freight', 'oil', 'feed', 'livestock'])
    ok(ids.indexOf(id) >= 0, 'class "' + id + '" is declared');
  /* 🔴 TWO CLASSES AND NOT ONE 'farm' CLASS, and this is the assertion that
     records why: rollRig() picks WITHIN a class, so a player who wants to move
     cattle and gets a grain hopper is what one merged class would mean. */
  const feed = PP_RIGS.filter(r => cargoClassOf(r) === 'feed');
  const stock = PP_RIGS.filter(r => cargoClassOf(r) === 'livestock');
  ok(feed.length >= 2, 'the Bulk Feed class has a ladder, not a single row a tab would show forever', String(feed.length));
  ok(stock.length >= 2, 'the Livestock class has a ladder', String(stock.length));
  ok(feed.every(r => r.type === 'Bulk Feeder'), 'every feed rig prints as a Bulk Feeder');
  ok(stock.every(r => r.type === 'Livestock Hauler'), 'every livestock rig prints as a Livestock Hauler');
  ok(feed.every(r => r.tonnes > 0), 'a feed rig states its tonnes — the number its class exists for');
  ok(stock.every(r => r.head > 0), 'a livestock rig states its head count');
  ok(!feed.some(r => stock.indexOf(r) >= 0), 'no rig is in both');
  /* The default has to survive a class this build does not know: a row saved by
     a NEWER build must land somewhere, never nowhere. */
  ok(cargoClassOf({ cargoClass: 'antimatter' }) === 'freight', 'an unknown class reads as freight rather than vanishing off every tab');
  ok(cargoClassOf({}) === 'freight', 'and so does a row from before the field existed');
  for (const id of ['feed', 'livestock'])
    ok(!!(CARGO_CLASSES[id].label && CARGO_CLASSES[id].ico && CARGO_CLASSES[id].sub),
      id + ' carries the label, icon and subtitle the yard tab prints');
}

/* ── 3. EVERY MODEL PATH IS ON DISK *AND* ON THE DEPLOY ALLOW-LIST ────────── */
{
  const withModel = PP_RIGS.filter(r => r.model && r.model.url);
  ok(withModel.length >= 8, 'the rigs that claim a model', String(withModel.length));
  const urls = [...new Set(withModel.map(r => r.model.url))];
  for (const u of urls) {
    const rel = 'public' + u;
    ok(existsSync(rel), 'packed and present: ' + u);
    /* 🔴 THE HALF EVERYONE FORGETS. .assetsignore blocks every .glb by default,
       so a model with no re-include line loads perfectly in local dev and 404s
       only once it is in front of players. */
    ok(IGN.includes('!' + u.replace(/^\//, '')), u + ' is re-included in .assetsignore (without this it 404s in production only)');
  }
  ok(urls.includes('/models/trucks/feed_truck.glb'), 'the bulk feed truck is one of them');
  ok(urls.includes('/models/trucks/livestock_truck.glb'), 'the livestock truck is one of them');
  /* One model per class, not per tier — three exports of one silhouette is
     megabytes spent saying the same thing, and the tier is on the rarity chip. */
  ok(new Set(PP_RIGS.filter(r => cargoClassOf(r) === 'feed').map(r => r.model.url)).size === 1,
    'the feed ladder shares one model — a tier is a spec sheet, not a different vehicle');
  ok(new Set(PP_RIGS.filter(r => cargoClassOf(r) === 'livestock').map(r => r.model.url)).size === 1,
    'and so does the livestock ladder');
}

/* ── 4. THE RESOLVER: CATALOGUE FALLBACK IS THE WHOLE POINT ───────────────── */
{
  const ctx = {
    window: { MythicTransport: { rigs: { rigById: (id) => PP_RIGS.find(r => r.id === id) || null } } },
    Number, String,
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('_ppRigDef') + '\n' + fnText('_ppModelOf'), ctx);
  const of = (v) => vm.runInContext('_ppModelOf(' + JSON.stringify(v) + ')', ctx);

  ok(of({ name: 'a car' }) === null, 'a car with no uploaded model has none');
  /* The failure the user actually saw: a truck, in a modal, with a placeholder. */
  const parked = { haul: true, rigId: 'haul_penfold', cargoClass: 'livestock' };
  const m = of(parked);
  ok(m && m.url === '/models/trucks/livestock_truck.glb',
    'a PARKED rig with no modelUrl on its saved row still resolves one — resolving at render time is what stops a truck bought yesterday losing its model',
    JSON.stringify(m));
  ok(m && m.scale === 1 && m.rotY === 0, 'with usable viewer knobs', JSON.stringify(m));
  ok(of({ haul: true, rigId: 'haul_chaffhopper' }).url === '/models/trucks/feed_truck.glb', 'and a feed rig resolves the feed truck');
  /* An admin render of one specific vehicle still wins over the class model. */
  const own = of({ haul: true, rigId: 'haul_penfold', modelUrl: '/models/trucks/tanker.glb', modelScale: 0.6, modelRotY: 90 });
  ok(own.url === '/models/trucks/tanker.glb' && own.scale === 0.6 && own.rotY === 90,
    'a row that carries its OWN model keeps it — the catalogue is the fallback, not an override', JSON.stringify(own));
  ok(of({ haul: true, rigId: 'haul_flatbed' }).url === '/models/trucks/freight_semi.glb',
    'a freight rig resolves the white flatbed semi (v121v110 — the owner\'s truck for every freight rig)');
}

/* ── 5. THE CAPACITY READER, ONE PER CLASS ────────────────────────────────── */
{
  const ctx = { Number, String };
  vm.createContext(ctx);
  vm.runInContext('function _ppCargoClassOf(v){ return (v && v.cargoClass) || "freight"; }\n' +
    'const PP_RIG_CAPACITY = ' + litOf('PP_RIG_CAPACITY', '{') + ';\n' + fnText('_ppRigCapacity'), ctx);
  const cap = (cls, def) => vm.runInContext('_ppRigCapacity(' + JSON.stringify({ cargoClass: cls }) + ',' + JSON.stringify(def) + ')', ctx);
  ok(cap('oil', { litres: 9000 }).label === 'TANK', 'a tanker leads with its tank');
  ok(cap('feed', { tonnes: 12 }).text === '12 t', 'a feed bulker leads with tonnes', JSON.stringify(cap('feed', { tonnes: 12 })));
  ok(cap('livestock', { head: 18 }).text === '18 head', 'a stock deck leads with head', JSON.stringify(cap('livestock', { head: 18 })));
  ok(cap('freight', { cargo: 1.3 }) === null,
    'freight has none — its cargo multiplier IS its capacity and it is already printed one row above');
  ok(cap('feed', {}) === null, 'and a rig missing the number prints nothing rather than "0 t"');
}

/* ── 6. NO TWO-CLASS HARDCODES LEFT IN THE YARD ───────────────────────────── */
{
  const yard = fnText('_ppRenderRigs');
  ok(/const TABS = _ppRigClassIds\(\)\.map/.test(yard), 'the tabs are derived from the module class list');
  ok(!/id: 'oil', ico: '🛢️'/.test(yard), 'the two-entry TABS literal is gone');
  ok(!/_ppRigTab === 'oil' \? 'freight' : 'oil'/.test(yard), 'the two-way empty-tab flip is gone');
  ok(/stocked\[0\]/.test(yard), 'and an emptied tab falls back to the first class that HAS stock, whichever that is');

  const counts = fnText('_ppRigTabCounts');
  ok(!/\{ freight: 0, oil: 0 \}/.test(counts), 'tab counts are no longer a two-key literal');
  ok(/_ppRigClassIds\(\)\.forEach/.test(counts), 'every declared class gets a count');

  const stock = fnText('_ppStockRigs');
  ok(/_ppRigClassIds\(\)\.forEach/.test(stock),
    'the stocker walks the CLASS LIST, not the floor-depth map — taking the class list from that map is what would leave a new tab permanently empty');
  ok(/PP_RIG_CLASS_FLOOR_DEFAULT/.test(stock), 'and a class with no floor entry still gets stocked');

  const reader = fnText('_ppCargoClassOf');
  ok(/_ppRigClassIds\(\)\.indexOf/.test(reader), 'the class reader is a membership test');
  ok(!/=== 'oil' \? 'oil' : 'freight'/.test(reader), 'not the two-way ternary that would have filed every new rig as freight');

  const click = IDX.slice(IDX.indexOf('function _ppBindRigs'));
  ok(!/_ppRigTab = b\.dataset\.ppRigtab === 'oil' \? 'oil' : 'freight'/.test(click),
    'and the tab BUTTON accepts any known class — a tab that paints and then refuses to switch is the subtler half of this bug');
}

/* ── 7. THE SURFACES ACTUALLY RENDER THE SNAPSHOT ─────────────────────────── */
{
  /* Marking an element with data-ppa-thumb renders nothing on its own. */
  const bind = fnText('_ppBindRigs');
  ok(/_ppaFillThumbs/.test(bind), 'the yard fills its card thumbnails (it did not before — the markup alone leaves them on the placeholder forever)');
  const modal = fnText('_ppOpenAuctionModal');
  ok(/_ppaFillThumbs\(wrap\)/.test(modal), 'and so does the listing modal');
  ok(/_ppaViewModel\(mdl\.url/.test(modal),
    'whose own caption says "click → orbit · zoom" — now bound, having promised an interaction that did not exist');

  /* Every place a vehicle model is read goes through the resolver. A site left
     on the raw row field is a surface where rigs silently have no model. */
  const rawReads = (IDX.match(/data-ppa-thumb="'\s*\+\s*escapeHtml\(v\.modelUrl\)/g) || []).length;
  ok(rawReads === 0, 'no render site still reads v.modelUrl directly', String(rawReads));
  ok(/const mdl = _ppModelOf\(v\);/.test(IDX), 'they resolve through _ppModelOf');
  const sites = (IDX.match(/const mdl = _ppModelOf\(v\);/g) || []).length;
  ok(sites >= 6, 'at every vehicle surface: yard card, listing modal, lot modal, lot slip, P2P card, P2P modal', String(sites));
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
