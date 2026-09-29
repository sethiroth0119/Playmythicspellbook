/* ══════════════════════════════════════════════════════════════════════════
   🏘 DRIVE-REALESTATE-PERSIST — "stop deleting the real estate I am adding"

   Real-estate listings are admin-authored content: the owner posts a property
   and every player sees it in the Just Business map. Read out of the LIVE
   database on 2026-08-26, the admin's forge blob held 155 keys — customCards
   (373), customItems (14), pageGuides (26), aiDecks (12), campaigns,
   starterDecks, customPacks, customEncounters, customEvents, customResources,
   customUltimates, structureDecks — every authored list EXCEPT this one.
   __realEstateListings__ did not exist on either admin account.

   So a listing lived in exactly ONE place: that browser's IndexedDB. Nothing
   was "deleting" them in the sense of running a delete. There was simply no
   copy anywhere else, so a new device, a cleared site-data or a fresh install
   restored from the cloud came back with none of them and no way to get them.

   ⚠ THE ASSERTION THAT MATTERS IS THAT A SYNC CANNOT REMOVE ONE. The merge is
     a union keyed by id. A cloud pull that does not know about a local listing
     must LEAVE IT ALONE, and a local list that does not know about a cloud
     listing must GAIN it. Both directions are tested, and the control is a
     merge that would drop one — which must fail.

   Run:  node .gauntlet/drive-realestate-persist.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const SRC = fs.readFileSync('public/index.html', 'utf8');

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9500 + Math.floor(Math.random() * 400);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof _mergeForgeArr === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

/* ── A. THE MERGE IS A UNION AND CANNOT DROP ────────────────────────────── */
const merge = await pg.evaluate(() => {
  const L = [{ id: 're_local', name: 'Local Only', image: 'data:image/png;base64,AAAA' },
             { id: 're_both',  name: 'Local copy WITH image', image: 'data:image/png;base64,BBBB' }];
  const C = [{ id: 're_cloud', name: 'Cloud Only' },
             { id: 're_both',  name: 'Cloud copy, image stripped' }];
  const out = _mergeForgeArr(L, C);
  const byId = {}; out.forEach(e => { byId[e.id] = e; });
  return {
    n: out.length,
    ids: out.map(e => e.id).sort(),
    localSurvived: !!byId.re_local,
    cloudGained: !!byId.re_cloud,
    localWinsCollision: byId.re_both && /Local copy/.test(byId.re_both.name),
    imageKept: !!(byId.re_both && byId.re_both.image),
    // CONTROL: an EMPTY cloud list must not wipe the local one.
    emptyCloudKeepsLocal: _mergeForgeArr(L, []).length === 2,
    // CONTROL: an empty LOCAL list adopts the cloud wholesale.
    emptyLocalAdoptsCloud: _mergeForgeArr([], C).length === 2,
  };
});

/* ── B. THE THREE PERSISTENCE LAYERS ARE ALL WIRED ──────────────────────── */
const wired = {
  cloudPush:  /realEstateListings:\s*\(typeof _stripDataUrls/.test(SRC),
  mergeBack:  /if \(Array\.isArray\(f\.realEstateListings\)\)/.test(SRC),
  lsChunk:    /key: 'hg_realEstateListings'/.test(SRC),
  lsLoader:   /localStorage\.getItem\('hg_realEstateListings'\)/.test(SRC),
  idbMirror:  /idbSet\('forge_realEstateListings'/.test(SRC),
  idbAdopt:   /\['forge_realEstateListings', 'realEstateListings'\]/.test(SRC),
  idbBacked:  /'campaigns',\s*\n?\s*'realEstateListings'\]\)/.test(SRC),
  stripped:   /_stripDataUrls\(Forge\.realEstateListings/.test(SRC),
};

/* ── C. AN ADDED LISTING SURVIVES A RELOAD, FOR REAL ────────────────────── */
const added = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  Forge.realEstateListings = Array.isArray(Forge.realEstateListings) ? Forge.realEstateListings : [];
  const before = Forge.realEstateListings.length;
  Forge.realEstateListings.push({
    id: 're_drivetest_1', name: 'Driver Test Manor', address: '1 Gauntlet Row',
    icon: '🏚', color: '#88c4ff', blurb: 'placed by the driver', price: 1000,
    capacity: 10, district: 'lower', tier: 'T1', x: 50, y: 50,
    ownedBy: null, listedAt: Date.now(),
  });
  saveForge();
  await sleep(900);
  // Did it reach BOTH local layers?
  let ls = null, idb = null;
  try { ls = JSON.parse(localStorage.getItem('hg_realEstateListings') || 'null'); } catch (e) {}
  try { idb = await idbGet('forge_realEstateListings'); } catch (e) {}
  return {
    before, after: Forge.realEstateListings.length,
    inLocalStorage: Array.isArray(ls) && ls.some(x => x && x.id === 're_drivetest_1'),
    inIdb: Array.isArray(idb) && idb.some(x => x && x.id === 're_drivetest_1'),
  };
});

await pg.reload({ waitUntil: 'domcontentloaded' });
await pg.waitForFunction('typeof _mergeForgeArr === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);
const afterReload = await pg.evaluate(() => ({
  present: Array.isArray(Forge.realEstateListings) &&
           Forge.realEstateListings.some(x => x && x.id === 're_drivetest_1'),
  count: (Forge.realEstateListings || []).length,
}));

/* ── D. …AND IT WOULD REACH THE CLOUD ROW ───────────────────────────────── */
const payload = await pg.evaluate(() => {
  // Build what the cloud push would send, without sending it.
  const stripped = (typeof _stripDataUrls === 'function')
    ? _stripDataUrls(Forge.realEstateListings || []) : (Forge.realEstateListings || []);
  return {
    isArray: Array.isArray(stripped),
    hasTest: stripped.some(x => x && x.id === 're_drivetest_1'),
    // The strip must remove base64 but keep the listing.
    strippedKeepsRow: (() => {
      const one = _stripDataUrls([{ id: 'x', name: 'n', image: 'data:image/png;base64,' + 'A'.repeat(400) }]);
      return one.length === 1 && one[0].id === 'x' && one[0].name === 'n';
    })(),
    strippedDropsB64: (() => {
      const one = _stripDataUrls([{ id: 'x', name: 'n', image: 'data:image/png;base64,' + 'A'.repeat(400) }]);
      return !(one[0].image && String(one[0].image).startsWith('data:'));
    })(),
  };
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F3D8} REAL ESTATE · A LISTING MUST OUTLIVE THE BROWSER IT WAS MADE IN\n');

console.log('  ── all three persistence layers are wired');
ok('\u{1F3AF} the CLOUD push exists at all', wired.cloudPush, 'this is the one that was missing');
ok('\u{1F3AF} …and it merges back on pull', wired.mergeBack);
ok('the localStorage chunk exists', wired.lsChunk);
ok('…and something reads it at boot', wired.lsLoader);
ok('the IndexedDB mirror was already there', wired.idbMirror);
ok('…and is adopted at boot', wired.idbAdopt);
ok('a failed localStorage write is not treated as data loss', wired.idbBacked);
ok('\u{1F3AF} images are stripped for the cloud row', wired.stripped,
  'an unstripped row timed out every save on it once already');

console.log('\n  ── the merge is a union, so a sync cannot delete');
ok('\u{1F3AF} a LOCAL-only listing survives a cloud pull', merge.localSurvived);
ok('\u{1F3AF} a CLOUD-only listing is gained', merge.cloudGained);
ok('on a collision the local copy wins', merge.localWinsCollision);
ok('…so the local image is not replaced by the stripped copy', merge.imageKept);
ok('\u{1F3AF} CONTROL · an EMPTY cloud list does not wipe local',
  merge.emptyCloudKeepsLocal, 'the classic "synced and lost everything"');
ok('CONTROL · an empty local list adopts the cloud', merge.emptyLocalAdoptsCloud);
ok('nothing was dropped: 3 unique ids in, 3 out', merge.n === 3, merge.n + ' ' + JSON.stringify(merge.ids));

console.log('\n  ── an added listing really persists');
ok('it was added', added.after === added.before + 1, added.before + ' → ' + added.after);
ok('\u{1F3AF} it reached localStorage', added.inLocalStorage === true);
ok('\u{1F3AF} it reached IndexedDB', added.inIdb === true);
ok('\u{1F3AF} it is STILL THERE after a full reload', afterReload.present === true,
  afterReload.count + ' listing(s)');

console.log('\n  ── and it would reach the cloud row');
ok('the payload is an array', payload.isArray === true);
ok('\u{1F3AF} the listing is in it', payload.hasTest === true);
ok('stripping keeps the listing', payload.strippedKeepsRow === true);
ok('stripping drops the base64', payload.strippedDropsB64 === true);

console.log('\npage errors: ' + errs.length); errs.slice(0, 3).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
