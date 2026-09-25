/* ══════════════════════════════════════════════════════════════════════════
   🚛 DRIVE-PP-RIGS — can a Prince Portfolios owner actually BUY A TRUCK?

   THE REPORT: "I do not see a section where players who own a Prince
   Portfolios can buy trucks." They could not. _ppGenListing() has rolled
   haul-class rigs onto the floor since the charter shipped, but the Auction tab
   renders `_ppaFloorBody()` — the live 3D bidding block — and the only renderer
   that ever drew a listing grid (`_ppRenderAuctionClassic`) is retained and not
   shown. Every rig the generator made was unreachable.

   WHAT THIS PROVES, in the shipped page, through the shipped render path:
     1. the yard STOCKS — _ppStockRigs() reaches PP_RIG_FLOOR haul listings
     2. the tab is REACHABLE — a HAUL RIGS nav entry exists and paints cards
     3. a rig is BUYABLE — the shipped ppBuyVehicle() parks it on the lot and
        debits the price
     4. 🔴 THE CONTROL, which is the half this project keeps learning it needs:
        with window.MythicTransport removed the yard paints its "catalogue not
        loaded" state and ZERO cards — so a passing (1)–(3) is evidence about
        the rigs and not about a grid that would draw anything at all.

   Run:  node .gauntlet/drive-pp-rigs.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8420 + (process.pid % 50);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
// The rig table arrives with /src/transport, which mounts on its own schedule.
await pg.waitForFunction('typeof ensurePrincePortfolios === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForFunction('!!(window.MythicTransport && window.MythicTransport.rollRig)', null, { timeout: 60000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const o = { steps: [] };
  const say = (k, v) => { o[k] = v; o.steps.push(k + '=' + JSON.stringify(v)); };

  o.reachable = ['ensurePrincePortfolios', '_ppStockRigs', '_ppHaulListings', '_ppRenderRigs', '_ppBindRigs', 'ppBuyVehicle', 'renderPrincePortfolios']
    .every(n => typeof window[n] === 'function' || typeof eval('typeof ' + n) === 'string' && eval('typeof ' + n) === 'function');
  o.moduleUp = !!(window.MythicTransport && typeof window.MythicTransport.rollRig === 'function');
  if (!o.moduleUp) { o.fatal = '/src/transport did not mount — nothing below is measurable'; return o; }

  const p = ensurePrincePortfolios();
  p.owned = true;
  p.listings.length = 0;                     // start from a floor with NO rigs on it
  p.lot.length = 0;
  Profile.gems = 5000000;

  // ── 1 · stocking ────────────────────────────────────────────────────────
  say('rigsBefore', _ppHaulListings(p).length);
  const added = _ppStockRigs(p);
  say('stocked', added);
  say('rigsAfter', _ppHaulListings(p).length);
  say('floor', typeof PP_RIG_FLOOR === 'number' ? PP_RIG_FLOOR : null);
  // every stocked row must really be haul-class, with a rig id the module knows
  say('allHaul', _ppHaulListings(p).every(v => v.haul === true && !!v.rigId &&
      !!(window.MythicTransport.rigs && window.MythicTransport.rigs.rigById(v.rigId))));
  // idempotent: a second call at floor adds nothing
  say('secondPass', _ppStockRigs(p));

  // ── 2 · the tab paints ──────────────────────────────────────────────────
  App.screen = 'princePortfolios'; App._ppTab = 'rigs';
  renderPrincePortfolios();
  const nav = Array.from(document.querySelectorAll('[data-pp-tab]')).map(b => b.dataset.ppTab);
  say('navHasRigs', nav.includes('rigs'));
  say('headerTitle', (document.querySelector('.wfa-header-title h1') || {}).textContent || '');
  const cards = document.querySelectorAll('[data-pp-rig]');
  say('cardsPainted', cards.length);
  say('cardsMatchStock', cards.length === _ppHaulListings(p).length);
  // the spec grid must carry real freight numbers, not dashes
  say('specText', (document.querySelector('.wfa-supply-specs') || {}).textContent || '');

  // ── 3 · a rig is buyable through the shipped path ───────────────────────
  const target = _ppHaulListings(p)[0];
  const gemsBefore = Profile.gems | 0;
  const bought = ppBuyVehicle(target.id);
  say('bought', bought === true);
  say('paid', gemsBefore - (Profile.gems | 0));
  say('price', target.price);
  say('onLotIsHaul', !!(p.lot[0] && p.lot[0].haul && p.lot[0].rigId === target.rigId));
  say('listingConsumed', !p.listings.some(l => l.id === target.id));

  // ── 4 · THE CONTROL ─────────────────────────────────────────────────────
  const MT = window.MythicTransport;
  try { delete window.MythicTransport; } catch (e) { window.MythicTransport = undefined; }
  p.listings = p.listings.filter(v => !v.haul);      // an all-car floor
  say('ctrlStocked', _ppStockRigs(p));               // must add nothing at all
  renderPrincePortfolios();
  say('ctrlCards', document.querySelectorAll('[data-pp-rig]').length);
  say('ctrlSaysWhy', /freight catalogue is not loaded/i.test(document.body.textContent || ''));
  window.MythicTransport = MT;
  return o;
});

const bad = [];
const need = (k, ok) => { if (!ok) bad.push(k); };
if (out.fatal) bad.push(out.fatal);
else {
  need('stocks to floor', out.rigsAfter >= out.floor && out.rigsBefore === 0);
  need('all stocked rows are haul-class', out.allHaul === true);
  need('stocker is idempotent at floor', out.secondPass === 0);
  need('HAUL RIGS nav entry', out.navHasRigs === true);
  need('header says HAUL RIGS', /HAUL RIGS/.test(out.headerTitle));
  need('cards painted', out.cardsPainted > 0 && out.cardsMatchStock === true);
  need('specs carry freight rows', /RUNS \/ DAY/.test(out.specText) && !/RUNS \/ DAY—/.test(out.specText.replace(/\s+/g, '')));
  need('buy succeeded', out.bought === true);
  need('charged exactly the asking price', out.paid === out.price);
  need('the rig parked on the lot', out.onLotIsHaul === true);
  need('listing consumed', out.listingConsumed === true);
  need('CONTROL: no module → no stock', out.ctrlStocked === 0);
  need('CONTROL: no module → no cards', out.ctrlCards === 0);
  need('CONTROL: no module → says why', out.ctrlSaysWhy === true);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 5) }, null, 2));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ') : '\n✅ PASS — the truck yard stocks, paints, sells, and goes dark with a reason when the catalogue is absent.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
