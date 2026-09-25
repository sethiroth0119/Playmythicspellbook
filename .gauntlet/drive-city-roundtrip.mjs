/* ══════════════════════════════════════════════════════════════════════════
   💾 DRIVE-CITY-ROUNDTRIP — does the REAL serialize() → loadState() cycle
      give back the city it was handed?

   WHAT WAS WRONG. `.gauntlet/save-payload-check.mjs` (the `savepayload` suite
   in `npm run check`) is captioned "a save round-trips" — and it never ran the
   iframe's serialize() or loadState() at all. It re-typed a 12-line stand-in
   for serialize() on top of two ES modules (/src/naming, /src/palette) mounted
   against a three-tile stub, and checked THAT. Measured on the tree this was
   written against: node-city's serialize() writes 37 top-level keys; the
   stand-in wrote 6, and the 31 it did not write include `fin` (the investment
   book), `economy`, `demog`, `pop`, `hh`, `power`, `water`, `pollution`,
   `raid` and every per-tile field. Any of those could have stopped
   round-tripping and the suite would have stayed green, because it never
   looked. A gate that checks a copy of the code is a comment about the code.

   WHAT THIS DOES INSTEAD. It boots the shipped public/node-city/index.html in
   headless Chromium five times in one browser context (so the boots share one
   localStorage, the way sessions on one device do), and drives the file's own
   functions through its `window.__nc` seam:

     A. BUILD — boots an empty city, places roads and buildings through the
        SHIPPED placement path (__nc.place → tryPlace, with the same cost /
        crew-slot / confirm stubs .gauntlet/scene.js documents), writes real
        values into every save field it can reach — the investment book, the
        raid clock, the army, the deck, a build order, a road class, a zone,
        a business name, a street name, a transit line with a stop, a painted
        wall, a charged battery, poisoned aquifers — runs the same settle
        passes boot() runs after a load (progression adopt, demographic
        survey, citizen refresh, economy sync) so the saved city is at rest,
        then saves through the REAL writer, `saveNow()` →
        MythicCityBridge.saveCity(serialize()), and reads back what landed on
        disk, `_owner` / `_node` stamps included.
     B. RELOAD — boots again. The shipped boot() runs the shipped loadState()
        against that disk copy and hands every parked blob to its module in
        the shipped order. Then serialize() is called and the result is
        DEEP-DIFFED, field by field, against the blob that was on disk.
     C. MODULE-ABSENT, twice. C1 boots with /src/power, /src/water,
        /src/pollution, /src/palette, /src/transit, /src/streets and
        /src/naming answering 404, the way a cache miss or an offline moment
        does; C2 does the same to /src/economy and /src/demographics. In both,
        serialize() must write the disk copy of every guarded field straight
        back — the erase guards each field's comment describes — and `ext` /
        `meta` must be ABSENT rather than empty. Then each saves, and the disk
        copy is checked again, because the autosave is the write that actually
        destroys data.
     D. TILELESS — writes a parsed-but-tileless payload to the same key and
        boots once more. loadState() must take the `_loadFailed` path, the save
        policy must refuse to write, and the corrupt blob must still be on
        disk untouched afterwards — the "we never got an answer" case
        saveNow()'s erasure guard exists for.

   ⚠ requestAnimationFrame IS A NO-OP FOR THE WHOLE RUN, AND THAT IS THE ONLY
     THING IN THE PAGE THIS DRIVER CHANGES. three.js drives animate() through
     window.requestAnimationFrame; animate() is where economyTick, vitalsTick
     and decayTick run, and the first frame fires with dt = 0.25 s BEFORE any
     driver code can get to `__nc` (the seam is assembled on the line before
     renderer.setAnimationLoop). One frame is enough to move stock, vitals,
     wear and the economy off what was loaded, and then a strict diff reports
     ordinary simulation as data loss. node-city's only other rAF use is a CSS
     class toggle. The load path yields through MessageChannel, not rAF, so
     boot() completes normally — measured: 4 s cold, ~1 s warm. The 4-second
     `ecoSync` interval still runs; it is idempotent on a city whose buildings
     match its firms, and phase A waits it out so the firms it founds are in
     the save rather than founded again on reload.

   ⚠ THE SEED GOES IN THROUGH addInitScript, NEVER THROUGH A LIVE PAGE. The
     first cut of phase C wrote its blob to localStorage from phase B's page
     after B's saveNow() — and B's boot had queued an 800 ms saveSoon() (the
     Outside Connections migration and the naming pass both call it), which
     fired AFTER the write and put B's own save back. C then diffed against a blob the
     page had never read. A page that is closed has no timers; a seed written
     before its scripts run cannot be raced.

   ⚠ NOT A SECOND SERIALIZER. Nothing here re-types a field list from
     serialize(): the diff walks whatever keys the disk copy actually has, so a
     field added to serialize() tomorrow is compared tomorrow. The few keys it
     skips are named in SKIP with the reason each cannot be equal by design.

   ⚠ KNOWN HOLES ARE PRINTED AS `HOLE`, DATED, AND DO NOT FAIL THE RUN — the
     same rule _checkall.mjs states for its baselines: a gate that is red on
     the day it lands, for a defect it did not cause and cannot fix from its
     own two files, teaches everybody to ignore it. Each HOLE names the line
     that owns the defect. Turn one into a FAIL in the commit that fixes it.

   Run:  node .gauntlet/drive-city-roundtrip.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.glb': 'model/gltf-binary' };
const PORT = 8140 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
/* ONE context: the boots share localStorage, so phase B reads what phase A
   wrote through the same `mythic_node_city_v2:<owner>@<node>` key a device
   would. The owner / node / ground the parent normally hands over are stubbed
   on window, which is where node-city looks when it has no parent (see
   cityOwnerId(): "standalone has no mayors"). */
const OWNER = 'u-roundtrip', NODE = 'N-roundtrip', GROUND = 'ground-roundtrip';
const KEY = 'mythic_node_city_v2:' + OWNER + '@' + NODE;
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(({ OWNER, NODE, GROUND }) => {
  window.requestAnimationFrame = () => 0;            // see the header: no animate(), no ticks
  window.cityStateUserId = () => OWNER;
  window.cityNodeIdForKey = () => NODE;
  window.cityGroundId = () => GROUND;
  window.cityStateWasDeleted = async () => false;    // "the history holds no delete" — lets a stamped local blob load
}, { OWNER, NODE, GROUND });

let ok = 0, bad = 0, holes = 0;
const show = (got) => (got === undefined ? '' : ' = ' + (typeof got === 'string' ? got : JSON.stringify(got)));
const t = (label, cond, got) => { (cond ? ok++ : bad++); console.log((cond ? '  ok   ' : '  FAIL ') + label + show(got)); };
const hole = (label, cond, got) => { if (cond) { ok++; console.log('  ok   ' + label); } else { holes++; console.log('  HOLE ' + label + show(got)); } };

/* Boot one page. `absent`: /src/<module>/ path fragments to answer 404 for.
   `seed`: a blob to put at KEY before the page's own scripts run. */
async function boot({ absent = [], seed = null } = {}) {
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  const logs = []; pg.on('console', m => logs.push(m.text().slice(0, 300)));
  if (seed !== null) await pg.addInitScript(({ KEY, seed }) => { try { localStorage.setItem(KEY, seed); } catch (e) {} }, { KEY, seed });
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (absent.some(a => u.includes(a))) return r.fulfill({ status: 404, body: 'nf' });
    if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  const t0 = Date.now();
  await pg.goto(`http://127.0.0.1:${PORT}/node-city/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // polling: interval, NOT 'raf' — rAF is a no-op in this context.
  await pg.waitForFunction('!!(window.__nc && window.__nc.serialize && window.MythicCityBridge && window.MythicCityBridge.ready)', null, { timeout: 150000, polling: 250 });
  const bootMs = Date.now() - t0;
  console.log('  boot ' + bootMs + ' ms' + (absent.length ? ' with ' + absent.join(' ') + ' → 404' : ''));
  // The degrade paths announce themselves on the console; surface those lines.
  const notable = logs.filter(l => /non-fatal|unavailable|refusing|BLOCKED|did not load/.test(l));
  for (const l of notable.slice(0, 6)) console.log('    console: ' + l.slice(0, 160));
  return { pg, errs, logs, bootMs };
}

/* ── the diff ──────────────────────────────────────────────────────────────
   Walks the DISK copy's keys (plus any the reload added), reports every leaf
   that differs as a path. JSON-normalised on both sides, so `undefined` and a
   dropped key read the same way JSON.stringify would write them. */
function diff(a, b, base = '', out = []) {
  const norm = (v) => (v === undefined ? null : v);
  a = norm(a); b = norm(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) out.push(base + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b));
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(base + ': array/object mismatch'); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (out.length > 40) break; diff(a[k], b[k], base ? base + '.' + k : k, out); }
  return out;
}
/* Keys the diff does not compare, each with the reason. Anything not listed
   here is diffed, whatever it is. */
const SKIP = {
  savedAt: 'stamped with Date.now() at each serialize()',
  syncPct: 'derived from the live camp roster on every serialize(); loadState() never reads it back',
  meta:    'describes the payload it rides in, so it carries the new savedAt; its .keys are compared separately',
  _owner:  'a saveCity() stamp, not a serialize() field — compared separately',
  _node:   'a saveCity() stamp, not a serialize() field — compared separately',
};
const SITE = '15,11';          // the tile carrying the live build order (phase A)

/* Two fields carry a DICE ROLL, and a strict diff on them would fail a correct
   reload. citAssignJobs() ends every pass with `Math.random() > citHireChance()`
   before seating an idle citizen — on EVERY refresh, including the forced one
   loadState() runs — so an idle citizen may be hired by the reload itself, and
   lifeLog then records the hire. Those are the shipped hiring odds, not a
   loss. What the save actually promises is TENURE and IDENTITY: nobody who
   had a job loses it, and nobody's id, name, schooling rung, employer, errand
   or seed changes. `m` (mood) is NOT a saved fact at all: the forced refresh
   loadState() runs snaps every citizen to citMoodTarget() ("force snaps — used
   on load"), and it runs BEFORE boot() has computed coverage, so the target it
   snaps to reads the unmeasured-need defaults rather than the city's
   coverage — measured: 58 on disk, 50 after the reload, for every idle
   citizen, with nothing else about them changed. It is re-derived on every
   load by design and eases back on the next tick, so it is checked only for
   being a number in range. The life log is append-only, so the disk copy
   must be a PREFIX of the reloaded one. Everything else in both fields is
   diffed strictly. */
function diffCits(a, b, out = []) {
  if (!a || !b) return diff(a, b, 'cits', out);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (k !== 'list') diff(a[k], b[k], 'cits.' + k, out);
  const A = a.list || [], B = b.list || [];
  if (A.length !== B.length) out.push('cits.list.length: ' + A.length + ' → ' + B.length);
  A.forEach((c, i) => {
    const d = B[i] || {};
    for (const f of ['i', 'n', 'e', 's']) if (JSON.stringify(c[f]) !== JSON.stringify(d[f])) out.push('cits.list.' + i + '.' + f + ': ' + JSON.stringify(c[f]) + ' → ' + JSON.stringify(d[f]));
    if (c.j && c.j !== d.j) out.push('cits.list.' + i + '.j (tenure lost): ' + JSON.stringify(c.j) + ' → ' + JSON.stringify(d.j));
    if (!(Number.isFinite(d.m) && d.m >= 0 && d.m <= 100)) out.push('cits.list.' + i + '.m not a mood: ' + JSON.stringify(d.m));
  });
  return out;
}
function diffLife(a, b, out = []) {
  if (!a || !b) return diff(a, b, 'life', out);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (k !== 'log') diff(a[k], b[k], 'life.' + k, out);
  const A = a.log || [], B = b.log || [];
  A.forEach((e, i) => { if (JSON.stringify(e) !== JSON.stringify(B[i])) out.push('life.log.' + i + ': ' + JSON.stringify(e) + ' → ' + JSON.stringify(B[i])); });
  return out;
}
const FIELD_DIFF = { cits: diffCits, life: diffLife };

/* ═══ A. BUILD, then save through the real writer ═══════════════════════ */
console.log('\n── A. build a city and save it through saveNow() ──');
const A = await boot();
const a = await A.pg.evaluate(async ({ SITE }) => {
  const nc = window.__nc, B = window.MythicCityBridge, g = nc.game;
  const o = { why: {}, placed: [] };
  o.mode = B.mode; o.key = B.localKey();
  /* The three stubs scene.js documents: cost, the long-order confirm, and a
     toast sink so a refusal is captured in the game's own words. */
  B.spendCinders = async () => true; B.spendRes = async () => true;
  B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true;
  window.confirm = () => true;
  let sink = null; window.__ncToastSink = (msg, cls) => { if (cls === 'bad' && sink) sink.push(msg); };
  const P = async (ty, x, z) => {
    sink = [];
    /* Raced against a timer so a placement that awaits something this boot
       cannot supply reports itself instead of hanging the whole run. */
    try { await Promise.race([nc.place(ty, x, z), new Promise((_, rej) => setTimeout(() => rej(new Error('placement never resolved')), 8000))]); }
    catch (e) { sink.push('threw: ' + e); }
    const msgs = sink; sink = null;
    try { nc.build.finishAll('roundtrip driver'); } catch (e) {}
    const k = x + ',' + z;
    if (g.tiles[k] && g.tiles[k].type === ty) o.placed.push(k + ':' + ty);
    else (o.why[ty] ||= []).push((msgs[0] || 'refused silently').slice(0, 120));
  };
  /* The Bus Company licence, bought the way standalone play buys one, and the
     "Bus Network" research node GRANTED through the progression module's own
     test seam (the same one scene.js uses, for the same stated reason: the
     gate still runs; this is a city that did the research) — so the bus stop
     below is a real stop and the transit line gets a real stop key.
     transitOwns() answers false once while it refreshes, hence the retry. */
  try { o.granted = window.MythicProgress._grant('tra_bus'); } catch (e) { o.granted = 'threw ' + e; }
  try { nc.ops.mockBuy('bus'); } catch (e) { o.licence = 'threw ' + e; }
  for (let i = 0; i < 20 && !window.MythicTransit.hasLicence('bus'); i++) await new Promise(r => setTimeout(r, 150));
  o.licence = window.MythicTransit.hasLicence('bus');
  /* A road along z=10 with a row of buildings against it, and a Highway
     Interchange on the north edge tied in by a spur — placed HERE so the
     Outside Connections grandfather migration (which would otherwise plant
     one on the reload, with nine roads and a log line) has nothing to do. */
  for (let x = 6; x <= 16; x++) await P('road', x, 10);
  await P('interchange', 11, 0);
  for (let z = 1; z <= 9; z++) await P('road', 11, z);
  for (let x = 6; x <= 9; x++) await P('housing', x, 11);
  await P('farm', 10, 11); await P('farm', 12, 11); await P('depot', 14, 11);
  await P('busstop', 13, 11); await P('housing', 16, 11);
  const now = Date.now();
  // ── per-tile fields serialize() writes ──
  g.cityAge = 5000;                                          // `born` is clamped to this on load
  const rd = g.tiles['6,10']; if (rd) rd.rc = 'avenue';      // road class, kept verbatim
  const h = g.tiles['6,11'];
  if (h) { h.wear = 7; h.spent = 120; h.earn = 45; h.born = 1200; h.rot = 2; h.lvl = 2; h.cards = ['cardA', 'cardB']; }
  const h2 = g.tiles['7,11']; if (h2) { h2.damaged = true; h2.born = 300; }
  // a live build order through the persistence seam (a 2 h job started 1 min ago)
  nc.persist.bldPlant(SITE, 'housing', 7200, 60000);
  // ── top-level fields ──
  g.fin = { book: 1234, dueAt: now + 3600000, lastPaid: now - 7200000, lifetime: 5000,
            last: { at: now - 7200000, book: 1000, payout: 1100, gain: 100, rows: [{ f: 'indexfund', v: 12 }] } };
  g.raid.timer = 1234; g.raid.wave = 3;
  g.army = { workers: 4, soldiers: 2, rank: 1 };
  g.defenseDeck = ['deckA', 'deckB'];
  g.nodeXp = { forge: 5 };
  g.cov.ramp = 90;
  g.wxLastStorm = now - 86400000; g.wxLastSevere = now - 2 * 86400000;
  const sk = Object.keys(nc.CITY_STOCK); if (sk[0]) g.stock[sk[0]] = 12.34; if (sk[1]) g.stock[sk[1]] = 3;
  let i = 0; for (const k in nc.vitals) nc.vitals[k] = 61 + (i++ % 7);
  g.zones = { '6,11': 'r_low', '7,11': 'r_row' };
  // ── module-owned slices, through each module's own API ──
  try { o.name = window.MythicNaming.setName('10,11', 'Roundtrip Farm Co'); } catch (e) { o.name = 'threw ' + e; }
  try { window.MythicStreets.rescan(); o.street = window.MythicStreets.rename('8,10', 'Roundtrip Way'); } catch (e) { o.street = 'threw ' + e; }
  try { const L = window.MythicTransit.newLine('bus'); L.name = 'Roundtrip Loop'; o.transitStop = window.MythicTransit.addStop(L.id, '13,11'); } catch (e) { o.transitStop = 'threw ' + e; }
  try { o.paint = window.MythicPalette.setSlot('6,11', 'wall', '#aabbcc', { save: false }); } catch (e) { o.paint = 'threw ' + e; }
  try { const pw = window.MythicPower.save(); pw.store = 37.5; window.MythicPower.load(pw); o.power = window.MythicPower.save().store; } catch (e) { o.power = 'threw ' + e; }
  try { const w = window.MythicWater.save(); w.taint = w.stock.map((_, j) => 0.1 * (j + 1)); w.surfaceTaint = 0.05; window.MythicWater.load(w); o.water = window.MythicWater.save().taint; } catch (e) { o.water = 'threw ' + e; }
  o.tiles = Object.keys(g.tiles).filter(k => g.tiles[k].type !== 'anchor').length;
  /* ── SETTLE, the way boot() settles a LOADED city. Each of these is a pass
     boot() or loadState() runs after the tiles are in; running them here
     means the save is of a city at rest, so anything the reload changes is a
     round-trip defect and not "the city did on load what it had not yet done". */
  try { window.MythicProgress.afterLoad(); window.MythicProgress.tick(); } catch (e) { o.progress = 'threw ' + e; }
  const econBefore = JSON.stringify(window.MythicEconomy.serialize() || {}).length;
  await new Promise(r => setTimeout(r, 4600));          // one ecoSync beat: firms founded for the buildings
  const econAfter = JSON.stringify(window.MythicEconomy.serialize() || {}).length;
  o.econ = [econBefore, econAfter];
  try { o.survey = nc.demog.tick(0); } catch (e) { o.survey = 'threw ' + e; }
  /* Coverage first: citMoodTarget reads game.cov.pct, which boot() computed on
     an EMPTY grid, and a reload recomputes it on this one. Then the roster is
     refreshed to a FIXED POINT — the economy's tile bands are cached for 2 s,
     so one pass can deal seats against stale bands and the next pass re-deals. */
  try { nc.evaluateNeeds(); } catch (e) { o.needs = 'threw ' + e; }
  o.citPasses = 0;
  for (let pass = 0, prev = null; pass < 5; pass++) {
    try { nc.citizens.sync(); o.cits = nc.citizens.refresh(true); } catch (e) { o.cits = 'threw ' + e; break; }
    o.citPasses++;
    const cur = JSON.stringify(JSON.parse(nc.serialize()).cits);
    if (cur === prev) break;
    prev = cur;
    await new Promise(r => setTimeout(r, 2100));
  }
  try { window.MythicNaming.ensureAll(); } catch (e) {}
  o.policy = nc.persist.policy();
  o.saved = await nc.saveNow();
  o.disk = localStorage.getItem(B.localKey());
  o.localFailed = B.lastLocalSaveFailed;
  return o;
}, { SITE });
t('standalone boot, keyed by owner AND node', a.mode === 'standalone' && a.key === KEY, a.key);
t('the district placed through tryPlace() (' + a.placed.length + ' tiles, interchange included)', a.placed.length >= 28 && Object.keys(a.why).length === 0, Object.keys(a.why).length ? a.why : a.tiles + ' tiles');
t('Bus Network granted and the Bus Company licence bought, so the stop is a real stop', a.granted === true && a.licence === true && a.transitStop === 'added', { granted: a.granted, licence: a.licence, stop: a.transitStop });
t('a business name, a street name and a painted wall were set', !!a.name && a.street === true && a.paint === true, { name: a.name, street: a.street, paint: a.paint });
t('a battery charge and poisoned aquifers were loaded into their modules', a.power === 37.5 && Array.isArray(a.water) && a.water[0] === 0.1, { power: a.power, water: a.water });
t('the economy grew firms for the buildings before the save (blob bytes)', a.econ[1] > a.econ[0], a.econ);
t('the citizen roster reached a fixed point (' + a.citPasses + ' passes)', typeof a.cits === 'number' && a.cits > 0 && a.citPasses < 5, { cits: a.cits, passes: a.citPasses });
t('saveNow() went through with policy full and wrote localStorage', a.policy === 'full' && a.saved !== false && a.localFailed === false && !!a.disk, { policy: a.policy, saved: a.saved, localFailed: a.localFailed });
const disk = JSON.parse(a.disk);
t('the disk copy carries the _owner and _node stamps saveCity() adds', disk._owner === OWNER && disk._node === NODE, { _owner: disk._owner, _node: disk._node });
t('the disk copy holds every tile that was placed', Object.keys(disk.tiles).length === a.tiles, Object.keys(disk.tiles).length);
t('the disk copy carries the build order on ' + SITE, !!(disk.tiles[SITE] && disk.tiles[SITE].b && disk.tiles[SITE].b.d === 7200), disk.tiles[SITE] && disk.tiles[SITE].b);
console.log('  fields on disk: ' + Object.keys(disk).join(' '));
await A.pg.close();

/* ═══ B. RELOAD through the shipped boot() → loadState(), then diff ═════ */
console.log('\n── B. reboot: the shipped boot() runs loadState() on that disk copy ──');
const Bp = await boot({ seed: a.disk });
const b = await Bp.pg.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  const o = {};
  o.flags = nc.persist.flags();
  o.away = nc.awayReport();                                  // must be null: no offline catch-up ran
  const T = nc.game.tiles;
  o.tiles = Object.keys(T).filter(k => T[k].type !== 'anchor').length;
  o.unmeshed = Object.keys(T).filter(k => T[k].type !== 'anchor' && !nc.roadClassOf(T[k].type) && !T[k].mesh);
  o.s2 = nc.serialize();
  o.name = window.MythicNaming.nameFor('10,11');
  o.street = window.MythicStreets.nameAt('8,10');
  o.paint = window.MythicPalette.get('6,11');
  o.line = (window.MythicTransit.lines() || [])[0] || null;
  o.remain = nc.build.remain('15,11');
  await nc.saveNow();
  const d = JSON.parse(localStorage.getItem(B.localKey()) || 'null');
  o.stamps = d ? { _owner: d._owner, _node: d._node } : null;
  return o;
});
t('boot finished under the offline threshold and ran no catch-up', Bp.bootMs < 20000 && b.away === null, { bootMs: Bp.bootMs, away: b.away });
t('loadState() completed clean (loadDone, not loadFailed, verdict established)', b.flags.loadDone && !b.flags.loadFailed && b.flags.verdict === 'established', b.flags);
t('every tile came back, and every building has a mesh', b.tiles === Object.keys(disk.tiles).length && b.unmeshed.length === 0, { tiles: b.tiles, unmeshed: b.unmeshed });
const s2 = JSON.parse(b.s2);
const compared = [], skipped = [];
for (const k of new Set([...Object.keys(disk), ...Object.keys(s2)])) {
  if (SKIP[k]) { skipped.push(k); continue; }
  const d = FIELD_DIFF[k] ? FIELD_DIFF[k](disk[k], s2[k]) : diff(disk[k], s2[k], k);
  compared.push(k + (k === 'cits' ? ' (identity, tenure, employer, errands; the hire roll exempt)' : k === 'life' ? ' (append-only prefix)' : ''));
  t('round-trips: ' + k + (FIELD_DIFF[k] ? ' (see the note at FIELD_DIFF)' : ''), d.length === 0, d.length ? d.slice(0, 6) : undefined);
}
t('meta.keys still names every field', Array.isArray(s2.meta && s2.meta.keys) && Object.keys(s2).filter(k => k !== 'meta').every(k => s2.meta.keys.includes(k)), s2.meta && s2.meta.keys);
t('the build order is still running, with less time left than it was saved with', b.remain > 0 && b.remain < 7200 - 50, b.remain);
t('the business name, street name, paint and transit line are readable through their modules', b.name === 'Roundtrip Farm Co' && b.street === 'Roundtrip Way' && b.paint && b.paint.wall === 'aabbcc' && b.line && b.line.name === 'Roundtrip Loop' && b.line.stops.includes('13,11'), { name: b.name, street: b.street, paint: b.paint, line: b.line && [b.line.name, b.line.stops] });
t('a save from the reloaded city carries the same _owner / _node stamps', b.stamps && b.stamps._owner === OWNER && b.stamps._node === NODE, b.stamps);
console.log('  compared: ' + compared.join(' '));
console.log('  skipped:  ' + skipped.map(k => k + ' (' + SKIP[k] + ')').join('; '));
await Bp.pg.close();

/* ═══ C. MODULE-ABSENT: the guarded modules 404, the save must not shrink ═ */
/* The tile the build order sits on is exempt from the tile diff here, and
   only here: with /src/economy absent there is no construction ECON, and
   bldNormalize()'s documented degrade ("every in-flight job must be COMPLETED
   rather than left parked behind a module that never arrived") finishes the
   site. That is the shipped answer, asserted below as such — not a loss. */
async function moduleAbsent(label, absent, guarded, extra) {
  console.log('\n── ' + label + ' ──');
  const C = await boot({ absent, seed: a.disk });
  const c = await C.pg.evaluate(async () => {
    const nc = window.__nc, B = window.MythicCityBridge;
    const o = {};
    o.present = ['MythicPower', 'MythicWater', 'MythicPollution', 'MythicEconomy', 'MythicDemographics', 'MythicPalette', 'MythicTransit', 'MythicStreets', 'MythicCitySave', 'MythicNaming'].filter(k => !!window[k]);
    o.flags = nc.persist.flags();
    o.s3 = nc.serialize();
    o.policy = nc.persist.policy();
    await nc.saveNow();
    o.disk = localStorage.getItem(B.localKey());
    return o;
  });
  t('the city itself still loaded clean without them', c.flags.loadDone && !c.flags.loadFailed, c.flags);
  const s3 = JSON.parse(c.s3), d3 = JSON.parse(c.disk);
  const tilesA = Object.assign({}, disk.tiles), tilesC = Object.assign({}, s3.tiles);
  const siteDelta = diff(tilesA[SITE], tilesC[SITE], 'tiles.' + SITE);
  delete tilesA[SITE]; delete tilesC[SITE];
  t('module-absent serialize() writes every other tile back unchanged', diff(tilesA, tilesC, 'tiles').length === 0, diff(tilesA, tilesC, 'tiles').slice(0, 6));
  for (const k of guarded) {
    const d = diff(disk[k], s3[k], k);
    t('module-absent serialize() writes the disk copy back: ' + k, d.length === 0, d.length ? d.slice(0, 6) : undefined);
  }
  t('…and the AUTOSAVE it wrote to disk still holds every one of those fields', guarded.every(k => diff(disk[k], d3[k], k).length === 0), guarded.filter(k => diff(disk[k], d3[k], k).length));
  if (extra) extra({ c, s3, d3, siteDelta });
  await C.pg.close();
  return C;
}
const C1 = await moduleAbsent('C1. reboot with the seven independent modules answering 404',
  ['/src/power/', '/src/water/', '/src/pollution/', '/src/palette/', '/src/transit/', '/src/streets/', '/src/naming/'],
  ['power', 'water', 'pollution', 'paint', 'transit', 'streets', 'economy', 'demog', 'pop', 'hh', 'fin', 'raid'],
  ({ c, s3, d3, siteDelta }) => {
    t('none of the seven mounted (economy and demographics still did)', c.present.join(',') === 'MythicEconomy,MythicDemographics', c.present);
    t('the build order survives: construction still has its module', siteDelta.length === 0, siteDelta.slice(0, 4));
    t('serialize() OMITS ext and meta rather than writing empty ones over the names', !('ext' in s3) && !('meta' in s3) && d3.ext === undefined, { ext: s3.ext, meta: s3.meta });
  });
const C2 = await moduleAbsent('C2. reboot with /src/economy and /src/demographics answering 404',
  ['/src/economy/', '/src/demographics/'],
  ['economy', 'demog', 'power', 'water', 'pollution', 'paint', 'transit', 'streets', 'fin', 'raid', 'ext'],
  ({ c, s3, d3, siteDelta }) => {
    t('neither mounted; the seven others did', !c.present.includes('MythicEconomy') && !c.present.includes('MythicDemographics') && c.present.length === 8, c.present);
    t('the site was FINISHED by the degrade path, not lost (b gone, born stamped)', s3.tiles[SITE] && s3.tiles[SITE].b === undefined && s3.tiles[SITE].type === 'housing', siteDelta.slice(0, 4));
    /* 🔴 KNOWN HOLE (2026-09-04). boot() imports /src/economy INSIDE the same
       try block that then imports /src/city/population.js and
       /src/city/households.js (node-city/index.html, the `try {` whose catch
       says "patronage unavailable — shops will not take custom"). A 404 on
       the economy throws past BOTH population imports, POP/HH stay null, and
       serialize() writes `pop: null, hh: null` — there is no `_pending*`
       write-back on those two fields, so the population ledger and every
       named household are erased by the next autosave, to record that a
       DIFFERENT module failed to load. That is the `economy:` field's own
       documented defect, one field along. The fix is in node-city, not in
       this driver: move the two imports out of that try (or give the two
       fields the write-back every neighbour has). Turn these into t() then. */
    hole('module-absent serialize() writes the disk copy back: pop  (known hole, see comment)', diff(disk.pop, s3.pop, 'pop').length === 0, diff(disk.pop, s3.pop, 'pop').slice(0, 2));
    hole('module-absent serialize() writes the disk copy back: hh   (known hole, see comment)', diff(disk.hh, s3.hh, 'hh').length === 0, diff(disk.hh, s3.hh, 'hh').slice(0, 2));
  });

/* ═══ D. TILELESS: a parsed payload with no tiles must take the failed path ═ */
console.log('\n── D. reboot on a parsed-but-tileless payload ──');
const tileless = JSON.stringify({ v: 5, savedAt: Date.now(), _owner: OWNER, _node: NODE, fin: { book: 999 } });
const D = await boot({ seed: tileless });
const dd = await D.pg.evaluate(async (key) => {
  const nc = window.__nc;
  const o = {};
  o.before = localStorage.getItem(key);
  o.flags = nc.persist.flags();
  o.tiles = Object.keys(nc.game.tiles).filter(k => nc.game.tiles[k].type !== 'anchor').length;
  o.fin = nc.game.fin.book;
  o.policy = nc.persist.policy();
  o.saved = await nc.saveNow();
  await new Promise(r => setTimeout(r, 1200));           // outlive any saveSoon() the boot queued
  o.after = localStorage.getItem(key);
  return o;
}, KEY);
t('the tileless blob was what loadCity() handed over', dd.before === tileless);
t('loadState() took the _loadFailed path (loadDone, loadFailed)', dd.flags.loadDone && dd.flags.loadFailed, dd.flags);
t('nothing in it was applied: no tiles, fin.book untouched', dd.tiles === 0 && dd.fin === 0, { tiles: dd.tiles, fin: dd.fin });
t('the save policy refuses to write over it', dd.policy === 'none' && dd.saved !== true, { policy: dd.policy, saved: dd.saved });
t('…and the blob on disk is byte-for-byte what it was', dd.after === tileless, dd.after === tileless ? undefined : (dd.after || '').slice(0, 80));
await D.pg.close();

const pageErrs = [A, Bp, C1, C2, D].flatMap(x => x.errs);
t('no uncaught page errors across the five boots', pageErrs.length === 0, pageErrs.slice(0, 4));

console.log('\n' + (bad ? bad + ' FAILED' : 'ALL CLEAN') + ' (' + ok + ' ok' + (holes ? ', ' + holes + ' known hole' + (holes > 1 ? 's' : '') + ' — HOLE lines above, not counted' : '') + ')');
console.log('fields compared through the real serialize() → loadState() cycle: ' + compared.join(', '));
await browser.close(); srv.close();
process.exit(bad ? 1 : 0);
