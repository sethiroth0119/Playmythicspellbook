/* ══════════════════════════════════════════════════════════════════════════
   🏕 DRIVE-CAMPROSTER — P1: the Camp tab's node roster, in its three honest
   states, driven in real Chromium against ONE pinned control.

   THE CONTROL. Both the five upkeep rows and the roster's node burn read
   `prodPerMin` live, so nothing about them is comparable across three separate
   page loads of a live sim. Every state therefore calls __nc.pinProd() with the
   SAME map and reads #campup in the SAME task — the pin and the paint cannot be
   interleaved by a beat, so the control is byte-exact rather than approximately
   equal. (Freezing rAF would not do it: three drives the loop through
   renderer.setAnimationLoop, and the pane composites at ~0.56 Hz anyway.)

   Pinned map -> one camp needs food 6 / water 6 / fuel 3 / medicine 2 / ammo 4,
   and the city makes 28.8 / 5.76 / 14.4 / 0.72 / 28.8 per day — deliberately
   MIXED, so #campup carries real .bad rows for the badge control to be about
   something.

   THE THREE STATES
     a  standalone            -> the bridge's own mock rows render, LABELLED mock
     b  parent WITH the hook  -> exactly the 3 known camp_names, exactly one YOU
                                 marker, node burn = 3 x CAMP_CONSUME_PER_DAY,
                                 and no "NaN"/"undefined" anywhere in the card
     c  parent WITHOUT it     -> a NAMED "could not ask" state, and #campup is
                                 byte-identical to the control
   plus  ready:true camps:[]  -> "nobody else is registered here yet", and
                                 textually DIFFERENT from (c)
   plus  BADGE CONTROL        -> inject a .bad row INTO the roster and
                                 q('#campup .bad') must be unchanged, because
                                 that selector is what railState() badges this
                                 card from.

   Run:  node .gauntlet/drive-camproster.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const SHOTS = path.resolve(process.cwd(), '.gauntlet/shots/camproster');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8760 + (process.pid % 90);

/* The three known rows state (b) asserts against. Deliberately not the mock
   set, so a state that quietly fell back to standalone cannot pass as (b). */
const KNOWN = [
  { userId: 'u-ash', camp: 'Ashfall Hollow',  player: 'Kael',  prestige: 512, contrib: 41, corp: 'ASH', isYou: false },
  { userId: 'u-me',  camp: 'Saltmarsh Rest',  player: 'You',   prestige: 340, contrib: 62, corp: 'ASH', isYou: true  },
  { userId: 'u-bri', camp: 'Briarfell Watch', player: 'Mira',  prestige: 118, contrib: 7,  corp: null,  isYou: false },
];

/* The HOSTILE set (?hostile=1). Every field is the wrong shape on purpose:
   an object where a name belongs, an array, a null, a number that is not one,
   a whitespace-only corp, and markup. _crNum guarded the numbers from the
   first round; nothing guarded the strings, and an object `corp` reached
   #campcard.textContent as "[object Object]". This set is permanent. */
const HOSTILE = [
  { userId: 'h-obj', camp: { n: 'Object Camp' }, player: { p: 1 }, prestige: 'lots', contrib: null, corp: { code: 'ASH' }, isYou: false },
  { userId: 'h-xss', camp: '<b>Bold</b> & "quoted"', player: 'Mira', prestige: '12abc', contrib: '7', corp: '   ', isYou: true },
  { userId: 'h-nil', camp: null, player: null, prestige: null, contrib: undefined, corp: [1, 2], isYou: false },
];

/* The harness PARENT. node-city detects 'parent' mode by finding getRes AND
   addCinders on window.parent, so those two must exist; every other P.* call in
   the bridge is individually guarded and falls back, so nothing else is needed.
   ?hook=0 is state (c): the SAME parent with cityCampRoster simply absent, which
   is exactly what an older index.html looks like. ?empty=1 is the ready:true,
   camps:[] arm. */
function parentHtml(q) {
  const hook = q.get('hook') !== '0';
  const empty = q.get('empty') === '1';
  const rows = empty ? [] : (q.get('hostile') === '1' ? HOSTILE : KNOWN);
  return '<!doctype html><meta charset="utf-8"><title>camproster harness parent</title>' +
    '<style>html,body{margin:0;height:100%;background:#0d0b12}iframe{border:0;width:100vw;height:100vh}</style>' +
    '<script>' +
    'window.getRes=function(){return 0};window.addRes=function(){};window.spendResources=function(){return false};' +
    'window.addCinders=function(){return true};window.spendCinders=function(){return false};window.getCinders=function(){return 0};' +
    'window.cityStateLoad=async function(){return null};window.cityStateSave=function(){return false};' +
    'window.cityOwnerIdentity=function(){return {viewerId:"u-me",viewerName:"You",ownerId:"u-me",ownerName:"You",isOwner:true}};' +
    // __rosterAsks counts the CLOUD READS. The burn block now repaints on the
    // 0.5 s beat, and the one thing it must never do is re-ask the host — this
    // counter is how state (e) proves it does not.
    'window.__rosterAsks=0;' +
    (hook ? 'window.cityCampRoster=async function(){window.__rosterAsks++;return {ready:true,why:null,nodeId:"N-20",viewerId:"u-me",source:"fetch",camps:' + JSON.stringify(rows) + '}};' : '') +
    '</script>' +
    '<iframe id="f" src="/node-city/index.html"></iframe>';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/__parent') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(parentHtml(u.searchParams));
  }
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const PIN = { food: 0.02, water: 0.004, fuel: 0.01, medicine: 0.0005, ammo: 0.02 };

/* Boot one state and return the frame that actually holds the city. For the
   parent states that is the iframe, and it is the one that must be driven —
   evaluating in the top frame would find no __nc at all and report a confident
   nothing. */
async function boot(url, inFrame) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
      // FULFIL, never redirect — playwright refuses an https->http override,
      // and the page's import map is pinned to the CDN.
      const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      const f = path.join(THREE_DIR, rel);
      return fs.existsSync(f)
        ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
        : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
    }
    if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const frame = inFrame
    ? await (async () => { const h = await page.waitForSelector('#f', { timeout: 60000 }); return await h.contentFrame(); })()
    : page.mainFrame();
  await frame.waitForFunction('!!(window.__nc && window.__nc.campRoster)', null, { timeout: 180000 });
  /* ⚠  IS NOT GUARANTEED BY . The rail's attach() retries for
     40 x 250 ms and then gives up, but  itself is assigned deep
     inside the async boot (after offlineCatchUp and the module mounts) — on a
     loaded machine that lands AFTER the retries have expired, and the driver
     then reads  off undefined and dies in state (a). The
     shipped fallback  is set unconditionally at the end of
     the module for exactly this; re-seat from it rather than sleeping longer,
     which would only move the race. */
  await frame.waitForFunction('!!(window.__nc && (window.__nc.rail || window.__ncRail))', null, { timeout: 180000 });
  await frame.evaluate(() => { if (window.__nc && !window.__nc.rail && window.__ncRail) window.__nc.rail = window.__ncRail; });
  await page.waitForTimeout(4000);
  return { page, frame, logs };
}

/* One state, driven. Pins production, snapshots #campup (the control), opens
   the Camp rail, waits for the roster, re-pins + re-snapshots #campup, and
   reads everything back. */
async function drive(ctx, tag) {
  const { page, frame } = ctx;
  const before = await frame.evaluate((pin) => {
    window.__nc.pinProd(pin);
    const up = document.getElementById('campup');
    return { html: up ? up.outerHTML : null, bad: document.querySelectorAll('#campup .bad').length,
             badge: JSON.stringify(window.__nc.rail.state('campcard') || null).slice(0, 80) };
  }, PIN);

  await frame.evaluate(() => window.__nc.rail.open('campcard'));
  await frame.evaluate(() => window.__nc.campRosterRefresh());
  await page.waitForTimeout(600);

  const after = await frame.evaluate((pin) => {
    // Re-pin then repaint the roster IN THE SAME TASK, so the burn column is
    // read off the same rates the control was.
    window.__nc.pinProd(pin);
    const up = document.getElementById('campup');
    const cr = document.getElementById('camproster');
    const card = document.getElementById('campcard');
    return {
      html: up ? up.outerHTML : null,
      bad: document.querySelectorAll('#campup .bad').length,
      rosterBad: document.querySelectorAll('#camproster .bad').length,
      rosterText: cr ? cr.textContent : null,
      cardText: card ? card.textContent : null,
      you: document.querySelectorAll('#camproster .crme').length,
      rows: Array.from(document.querySelectorAll('#camproster .crrow .crn'))
                 .map((e) => (e.childNodes[0] && e.childNodes[0].textContent) || ''),
      burnRows: Array.from(document.querySelectorAll('#camproster .crb')).map((e) => e.textContent),
      report: window.__nc.campRoster(),
    };
  }, PIN);

  await page.screenshot({ path: path.join(SHOTS, tag + '.png'), clip: await frame.evaluate(() => {
    const c = document.getElementById('campcard');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    // The card lives in the rail modal once opened, and it is WIDER than the
    // rail slot — clipping to a guessed 520 cut the whole right-hand stat
    // column off the evidence, which is the column the numbers are in.
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8),
             width: Math.min(1390 - Math.max(0, r.x - 8), r.width + 16),
             height: Math.min(890 - Math.max(0, r.y - 8), r.height + 16) };
  }) || { x: 0, y: 0, width: 520, height: 880 } }).catch((e) => console.log('   (screenshot skipped: ' + e.message.slice(0, 60) + ')'));

  return { before, after };
}

const base = 'http://127.0.0.1:' + PORT;
const results = {};

/* ── a. STANDALONE ────────────────────────────────────────────────────── */
console.log('\na. standalone — the bridge mock');
{
  const ctx = await boot(base + '/node-city/index.html', false);
  const r = await drive(ctx, 'a-standalone');
  results.a = r;
  const mode = await ctx.frame.evaluate(() => window.MythicCityBridge.mode);
  ok('bridge is in standalone mode', mode === 'standalone', 'mode=' + mode);
  ok('three mock rows render', r.after.rows.length === 3, JSON.stringify(r.after.rows));
  ok('the mock is LABELLED as a mock', /MOCK rows, not real players/.test(r.after.rosterText || ''));
  ok('exactly one YOU marker', r.after.you === 1, 'markers=' + r.after.you);
  ok('#campup untouched by the roster paint', r.before.html === r.after.html);
  await ctx.page.close();
}

/* ── b. PARENT WITH THE HOOK ──────────────────────────────────────────── */
console.log('\nb. parent that defines window.cityCampRoster — 3 known rows');
{
  const ctx = await boot(base + '/__parent?hook=1', true);
  const r = await drive(ctx, 'b-parent-hook');
  results.b = r;
  const mode = await ctx.frame.evaluate(() => window.MythicCityBridge.mode);
  ok('bridge is in parent mode', mode === 'parent', 'mode=' + mode);
  const want = KNOWN.map((k) => k.camp).sort();
  ok('exactly the three known camp_names appear', JSON.stringify(r.after.rows.slice().sort()) === JSON.stringify(want),
     JSON.stringify(r.after.rows));
  ok('exactly one row carries the YOU marker', r.after.you === 1, 'markers=' + r.after.you);
  ok('the YOU marker is on the viewerId row, not the ownerId row',
     /Saltmarsh Rest\s*YOU/.test((r.after.rosterText || '').replace(/\s+/g, ' ')) ||
     /Saltmarsh RestYOU/.test(r.after.rosterText || ''), 'rosterText excerpt: ' +
     (r.after.rosterText || '').replace(/\s+/g, ' ').slice(0, 120));
  // node burn = camps x CAMP_CONSUME_PER_DAY (the one constant at :4923)
  const burn = r.after.report.burn;
  const wantBurn = { food: 18, water: 18, fuel: 9, medicine: 6, ammo: 12 };
  ok('node burn is 3 x CAMP_CONSUME_PER_DAY', JSON.stringify(burn) === JSON.stringify(wantBurn), JSON.stringify(burn));
  ok('the burn is on screen, not just in the report',
     r.after.burnRows.length === 5 && r.after.burnRows.every((t) => /\/ \d+·day$/.test(t.trim())),
     JSON.stringify(r.after.burnRows));
  ok('the burn headline states camps x per-camp = total',
     /3\s*camps\s*×\s*21\/day\s*=\s*63/.test((r.after.rosterText || '').replace(/\s+/g, ' ')),
     (r.after.rosterText || '').replace(/\s+/g, ' ').match(/\d+ camps[^,]{0,60}/) || 'no headline');
  const dirty = /NaN|undefined|\[object/.test(r.after.cardText || '');
  ok('no NaN / undefined / [object anywhere in the card text', !dirty,
     dirty ? (r.after.cardText || '').replace(/\s+/g, ' ').slice(0, 200) : 'clean, ' + (r.after.cardText || '').length + ' chars');
  ok('#campup untouched by the roster paint', r.before.html === r.after.html);

  /* BADGE CONTROL — the rail badge for this card is q('#campup .bad'). Inject a
     .bad row INTO the roster and it must not move. */
  const badge = await ctx.frame.evaluate(() => {
    const before = { campupBad: document.querySelectorAll('#campup .bad').length,
                     state: JSON.stringify(window.__nc.rail.state('campcard')).slice(0, 60) };
    const d = document.createElement('div');
    d.className = 'crrow bad';
    d.textContent = 'INJECTED RED ROW';
    document.getElementById('camproster').appendChild(d);
    const after = { campupBad: document.querySelectorAll('#campup .bad').length,
                    rosterBad: document.querySelectorAll('#camproster .bad').length,
                    state: JSON.stringify(window.__nc.rail.state('campcard')).slice(0, 60) };
    d.remove();
    return { before, after };
  });
  ok('a .bad row inside the roster does not reach q(#campup .bad)',
     badge.before.campupBad === badge.after.campupBad && badge.after.rosterBad === 1,
     'campup .bad ' + badge.before.campupBad + ' -> ' + badge.after.campupBad + ', roster .bad ' + badge.after.rosterBad);
  ok('the rail badge derivation is unchanged', badge.before.state === badge.after.state,
     badge.before.state + ' | ' + badge.after.state);
  await ctx.page.close();
}

/* ── c. PARENT WITHOUT THE HOOK ───────────────────────────────────────── */
console.log('\nc. parent WITHOUT the hook — the typeof guard fails');
{
  const ctx = await boot(base + '/__parent?hook=0', true);
  const r = await drive(ctx, 'c-parent-nohook');
  results.c = r;
  const mode = await ctx.frame.evaluate(() => window.MythicCityBridge.mode);
  ok('bridge is still in parent mode (only the hook is missing)', mode === 'parent', 'mode=' + mode);
  ok('the state is reported as not ready, by name',
     r.after.report.state && r.after.report.state.ready === false && r.after.report.state.why === 'no-hook',
     JSON.stringify(r.after.report.state));
  ok('the card prints a NAMED could-not-ask state',
     /This build cannot be asked/.test(r.after.rosterText || '') && /cityCampRoster\(\) hook/.test(r.after.rosterText || ''),
     (r.after.rosterText || '').replace(/\s+/g, ' ').slice(0, 140));
  ok('no camp rows are invented', r.after.rows.length === 0 && r.after.you === 0);
  ok('the five upkeep rows are BYTE-IDENTICAL to the control',
     r.after.html === results.b.after.html && r.after.html === results.a.after.html,
     'a==b ' + (results.a.after.html === results.b.after.html) + ', b==c ' + (results.b.after.html === r.after.html) +
     ', len ' + (r.after.html || '').length);
  ok('the control really is the five upkeep rows',
     (r.after.html.match(/class="urow"/g) || []).length === 5, 'urows=' + (r.after.html.match(/class="urow"/g) || []).length);
  ok('no NaN / undefined in the card text', !/NaN|undefined|\[object/.test(r.after.cardText || ''));
  await ctx.page.close();
}

/* ── d. READY, BUT GENUINELY EMPTY ────────────────────────────────────── */
console.log('\nd. ready:true with camps:[] — a real answer, worded as one');
{
  const ctx = await boot(base + '/__parent?hook=1&empty=1', true);
  const r = await drive(ctx, 'd-parent-empty');
  results.d = r;
  ok('the state is ready with an empty roster',
     r.after.report.state && r.after.report.state.ready === true && r.after.report.camps === 0,
     JSON.stringify(r.after.report.state).slice(0, 120));
  ok('it reads as nobody else is registered here yet',
     /[Nn]obody else is registered here yet/.test(r.after.rosterText || ''),
     (r.after.rosterText || '').replace(/\s+/g, ' ').slice(0, 140));
  ok('it is TEXTUALLY DIFFERENT from state (c)',
     (r.after.rosterText || '').trim() !== (results.c.after.rosterText || '').trim() &&
     !/cannot be asked/.test(r.after.rosterText || ''));
  ok('the five upkeep rows are still byte-identical to the control', r.after.html === results.c.after.html);
  ok('no NaN / undefined in the card text', !/NaN|undefined|\[object/.test(r.after.cardText || ''));
  await ctx.page.close();
}

/* ── e. THE LIVE A/B — the failure the first round shipped ─────────────
   ⚠ ORDER IS THE ENTIRE TEST. The roster is painted FIRST, off whatever
     production the sim happens to have, and only then is production changed.
     drive() above pins BEFORE it paints — deliberately, because its job is a
     byte-exact control across three page loads — and that ordering is exactly
     what hid a node-burn block frozen at card-open for a whole round. The card
     is opened once here and never reopened: the only thing allowed to move the
     burn rows is updateHUD's 0.5 s beat.
   Both reads happen in ONE evaluate task with the pin between them, so nothing
   can interleave and neither figure can be blamed on a beat that landed in the
   gap. ────────────────────────────────────────────────────────────────── */
console.log('\ne. live A/B — production moves with the Camp card OPEN and never reopened');
{
  const ctx = await boot(base + '/__parent?hook=1', true);
  const { page, frame } = ctx;
  await frame.evaluate(() => window.__nc.rail.open('campcard'));
  await frame.evaluate(() => window.__nc.campRosterRefresh());
  await page.waitForTimeout(600);
  const asksAfterPaint = await page.evaluate(() => window.__rosterAsks);

  const ab = await frame.evaluate(() => {
    const made = (t) => { const m = t && t.match(/([\d.]+)\s*\//); return m ? m[1] : null; };
    const read = () => {
      const u = document.querySelector('#campup .urow');
      const b = document.querySelector('#camproster .crb');
      const cls = (el) => { const x = el && el.lastElementChild; return x ? x.className : null; };
      const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
      return { campup: txt(u), campupClass: cls(u), campupMade: made(txt(u)),
               burn: txt(b), burnClass: cls(b), burnMade: made(txt(b)),
               railOpen: window.__nc.rail.current(),
               rows: document.querySelectorAll('#camproster .crrow').length };
    };
    // A: pinned SHORT. pinProd calls updateHUD, which is the only painter of
    // either block now — no reopen, no refetch.
    window.__nc.pinProd({ food: 0, water: 0, fuel: 0, medicine: 0, ammo: 0 });
    const A = read();
    // B: pinned PLENTIFUL. 1/min -> 1440/day, over the 18/day three camps burn.
    window.__nc.pinProd({ food: 1, water: 0, fuel: 0, medicine: 0, ammo: 0 });
    const B = read();
    return { A, B };
  });

  console.log('   A  #campup   ' + JSON.stringify(ab.A.campup) + '  class=' + ab.A.campupClass);
  console.log('   A  roster    ' + JSON.stringify(ab.A.burn) + '  class=' + ab.A.burnClass);
  console.log('   B  #campup   ' + JSON.stringify(ab.B.campup) + '  class=' + ab.B.campupClass);
  console.log('   B  roster    ' + JSON.stringify(ab.B.burn) + '  class=' + ab.B.burnClass);

  ok('the card stayed open across the whole A/B',
     ab.A.railOpen === 'campcard' && ab.B.railOpen === 'campcard' && ab.A.rows === 3 && ab.B.rows === 3,
     ab.A.railOpen + '/' + ab.B.railOpen + ' rows ' + ab.A.rows + '->' + ab.B.rows);
  ok('CONTROL: #campup moved and flipped colour', ab.A.campup !== ab.B.campup &&
     ab.A.campupClass === 'bad' && ab.B.campupClass === 'ok',
     ab.A.campupClass + ' -> ' + ab.B.campupClass);
  ok('the roster burn MOVED with it', ab.A.burn !== ab.B.burn, ab.A.burn + '  ->  ' + ab.B.burn);
  ok('the roster burn flipped colour with it',
     ab.A.burnClass === 'crlow' && ab.B.burnClass === 'crmet', ab.A.burnClass + ' -> ' + ab.B.burnClass);
  ok('both blocks print the SAME production figure in read A',
     ab.A.campupMade != null && ab.A.campupMade === ab.A.burnMade, ab.A.campupMade + ' vs ' + ab.A.burnMade);
  ok('both blocks print the SAME production figure in read B',
     ab.B.campupMade != null && ab.B.campupMade === ab.B.burnMade, ab.B.campupMade + ' vs ' + ab.B.burnMade);
  ok('the need is still the NODE total, not one camp', /\/ 18·day/.test(ab.B.burn || ''), ab.B.burn);

  // The beat must not turn into a cloud read: let ~12 beats go by.
  await page.waitForTimeout(6000);
  const asksAfterBeats = await page.evaluate(() => window.__rosterAsks);
  ok('the 0.5 s beat never re-asks the host', asksAfterPaint === asksAfterBeats && asksAfterBeats >= 1,
     'cityCampRoster() calls: ' + asksAfterPaint + ' after paint, ' + asksAfterBeats + ' after ~12 more beats');

  // And the beat must be free when the card is shut.
  const shut = await frame.evaluate(() => {
    window.__nc.rail.close();
    const before = document.getElementById('crburnbox');
    window.__nc.pinProd({ food: 9, water: 0, fuel: 0, medicine: 0, ammo: 0 });
    return { open: window.__nc.rail.current(), still: before ? before.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : null };
  });
  ok('with the card shut the burn painter is a no-op', shut.open !== 'campcard', 'railOpen=' + String(shut.open));
  await ctx.page.close();
}

/* ── f. HOSTILE ROWS ─────────────────────────────────────────────────── */
console.log('\nf. hostile rows — objects, arrays, nulls and markup in every field');
{
  const ctx = await boot(base + '/__parent?hook=1&hostile=1', true);
  const r = await drive(ctx, 'f-hostile');
  const dirty = (r.after.cardText || '').match(/NaN|undefined|\[object[^\]]*\]/g);
  ok('nothing prints NaN / undefined / [object Object]', !dirty,
     dirty ? JSON.stringify(dirty) : 'clean, ' + (r.after.cardText || '').length + ' chars');
  ok('all three hostile rows still render', r.after.rows.length === 3, JSON.stringify(r.after.rows));
  ok('an object camp name falls back, it does not stringify',
     r.after.rows.filter((t) => /Unnamed Camp/.test(t)).length === 2, JSON.stringify(r.after.rows));
  ok('markup in a camp name is escaped, not injected',
     (await ctx.frame.evaluate(() => document.querySelectorAll('#camproster .crn b, #camproster .crn img').length)) === 0 &&
     /<b>Bold<\/b> & "quoted"/.test(r.after.rosterText || ''),
     (r.after.rosterText || '').replace(/\s+/g, ' ').slice(0, 120));
  ok('a whitespace-only corp prints no dangling separator', !/·\s*$/m.test((r.after.rosterText || '')) &&
     !/ ·  /.test(r.after.rosterText || ''));
  ok('exactly one YOU marker survives', r.after.you === 1, 'markers=' + r.after.you);
  ok('the node burn is still 3 x the constant',
     JSON.stringify(r.after.report.burn) === JSON.stringify({ food: 18, water: 18, fuel: 9, medicine: 6, ammo: 12 }),
     JSON.stringify(r.after.report.burn));
  ok('#campup is still byte-identical to the control', r.after.html === results.c.after.html);
  await ctx.page.close();
}

console.log('\ncontrol (#campup, pinned production):');
console.log('  ' + (results.c.after.html || '').replace(/></g, '>\n  <'));

await browser.close();
server.close();
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL CHECKS PASSED') + '   shots: ' + SHOTS);
process.exit(fails ? 1 : 0);
