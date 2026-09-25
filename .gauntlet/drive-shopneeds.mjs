/* ══════════════════════════════════════════════════════════════════════════
   🧾 DRIVE-SHOPNEEDS — "put the resources a building uses in their overview
   so players know what to get"

   The build shop showed a price and a description. It did not show INPUTS, so
   the only way to learn that a Cannery wants Grain was to buy one and watch it
   earn nothing. Worse, "what do I need" is not "what is in my store": a
   building that draws Steel is dead as soon as the pile runs out unless
   something in the city MAKES Steel — the local-inventory rule, whose failure
   mode is a shop with a full green panel earning zero forever.

   ⚠ THE VERDICT IS THE THING UNDER TEST, NOT THE LIST. Printing the input names
     is trivial and would pass a test that only checked for the word "Steel".
     What has to be true is that the SAME building reads differently in two
     cities — 'none' where nothing makes its input, 'made here' once a producer
     is standing — and that a construction site does NOT count as a producer.
     Every one of those has a control that must fail.

   Run:  node .gauntlet/drive-shopneeds.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 8650 + (process.pid % 40);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 170)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.game && window.__nc.BUILDINGS)', null, { timeout: 180000 });
await pg.waitForTimeout(2500);

const r = await pg.evaluate(() => {
  const nc = window.__nc, o = {};
  const K = (x, z) => x + ',' + z;
  const wipe = () => { for (const k of Object.keys(nc.game.tiles)) delete nc.game.tiles[k]; };
  const put = (x, z, type, extra) =>
    nc.game.tiles[K(x, z)] = Object.assign({ type, lvl: 1, rot: 0, born: 0, spent: 0, earn: 0, bld: null }, extra || {});

  /* Pick a real consumer off the shipped table rather than naming one: a test
     that hard-codes 'cannery' silently stops testing anything the day that row
     is renamed. Wanted: a building with a `use` whose input some OTHER building
     in the same table produces, so both halves of the verdict are reachable. */
  const B = nc.BUILDINGS;
  let CONSUMER = null, INPUT = null, PRODUCER = null;
  for (const [type, d] of Object.entries(B)) {
    if (!d || !d.use) continue;
    for (const rsc of Object.keys(d.use)) {
      const maker = Object.entries(B).find(([t2, d2]) => d2 && d2.gen && d2.gen[rsc] && t2 !== type);
      if (maker) { CONSUMER = type; INPUT = rsc; PRODUCER = maker[0]; break; }
    }
    if (CONSUMER) break;
  }
  o.consumer = CONSUMER; o.input = INPUT; o.producer = PRODUCER;
  if (!CONSUMER) return o;
  o.consumerName = B[CONSUMER].name; o.producerName = B[PRODUCER].name;

  const openShop = () => { nc.buildShop(true); };
  const cardOf = (type) => document.querySelector('[data-build="' + type + '"]');
  const read = (type) => {
    const c = cardOf(type); if (!c) return null;
    const tip = c.querySelector('.stip');
    const rows = Array.from(tip.querySelectorAll('.tnrow')).map(x => ({
      cls: x.className.replace('tnrow', '').trim(),
      text: x.textContent.replace(/\s+/g, ' ').trim(),
    }));
    return {
      chips: Array.from(c.querySelectorAll('.sneed i')).map(x => x.className),
      rows,
      makes: Array.from(tip.querySelectorAll('.tmakes span')).map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      hasRunsOn: /Runs on/.test(tip.textContent),
    };
  };

  // ── A. AN EMPTY CITY — nothing is made, nothing is stored ────────────────
  wipe();
  for (const k of Object.keys(nc.game.res || {})) nc.game.res[k] = 0;
  for (const k of Object.keys(nc.game.stock || {})) nc.game.stock[k] = 0;
  openShop();
  o.empty = read(CONSUMER);

  // ── B. STOCK BUT NO PRODUCER — the trap the wording has to name ──────────
  if (nc.game.res && Object.prototype.hasOwnProperty.call(nc.game.res, INPUT)) nc.game.res[INPUT] = 500;
  else if (nc.game.stock) nc.game.stock[INPUT] = 500;
  openShop();
  o.stocked = read(CONSUMER);

  // ── C. A PRODUCER UNDER CONSTRUCTION IS NOT A PRODUCER ───────────────────
  put(9, 9, PRODUCER, { bld: { k: 0, l: 1, s: Date.now() / 1000, d: 3600, pc: null, pr: null } });
  openShop();
  o.siteOnly = read(CONSUMER);

  // ── D. …and once it is finished, it is ────────────────────────────────────
  delete nc.game.tiles[K(9, 9)].bld;
  openShop();
  o.made = read(CONSUMER);

  /* ── E. CONTROL · a building with no inputs shows no Runs-on block ────────
     ⚠ IT MUST HAVE A CARD ON THE SHELF. The first version searched BUILDINGS
       and picked `road`, which has no shop card at all any more (carriageways
       moved to the 🛣 Roads tab), so `read()` returned null and the control
       failed for a reason that had nothing to do with the feature. Search the
       RENDERED shelf, not the table. */
  const NOINPUT = Object.entries(B).find(([t, d]) =>
    d && !d.use && !d.powerNeed && !!cardOf(t));
  o.noInputType = NOINPUT ? NOINPUT[0] : null;
  o.noInput = NOINPUT ? read(NOINPUT[0]) : null;

  // ── F. the produced side is listed too ───────────────────────────────────
  o.producerCard = read(PRODUCER);
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F9FE} BUILD SHOP · WHAT DOES THIS RUN ON\n');
ok('the shipped table has a consumer whose input something else makes', !!r.consumer,
  r.consumer + ' uses ' + r.input + ', made by ' + r.producer);

if (r.consumer) {
  const rowOf = (blk) => (blk && blk.rows || []).find(x => new RegExp(r.input, 'i').test(x.text)) || null;
  console.log('\n  ── ' + r.consumerName + ', which draws ' + r.input);
  ok('the card carries a Runs-on block at all', r.empty.hasRunsOn === true);
  ok('the input is named with its rate', /\d+\.\d\d\/min/.test((rowOf(r.empty) || {}).text || ''),
    (rowOf(r.empty) || {}).text);

  console.log('\n  ── the verdict changes with the city, which is the whole point');
  ok('\u{1F3AF} empty city → NONE, build a source', /none/.test((rowOf(r.empty) || {}).cls || ''),
    (rowOf(r.empty) || {}).text);
  ok('\u{1F3AF} stock but no producer → "in store", NOT "made here"',
    /store/.test((rowOf(r.stocked) || {}).cls || ''), (rowOf(r.stocked) || {}).text);
  ok('\u{1F3AF} CONTROL · a producer still under construction does NOT count',
    /store/.test((rowOf(r.siteOnly) || {}).cls || ''), (rowOf(r.siteOnly) || {}).text);
  ok('\u{1F3AF} …and the finished producer does', /made/.test((rowOf(r.made) || {}).cls || ''),
    (rowOf(r.made) || {}).text);

  console.log('\n  ── the card face');
  ok('input icons appear on the card itself', (r.empty.chips || []).length > 0,
    JSON.stringify(r.empty.chips));
  ok('\u{1F3AF} …and they carry the verdict too, so the grid reads at a glance',
    (r.empty.chips || []).some(c => /none/.test(c)) && (r.made.chips || []).every(c => !/none/.test(c)),
    'empty ' + JSON.stringify(r.empty.chips) + ' → made ' + JSON.stringify(r.made.chips));

  console.log('\n  ── the other half of the answer');
  ok('a producer lists what it PRODUCES', (r.producerCard.makes || []).length > 0,
    (r.producerCard.makes || [])[0]);
  ok('\u{1F3AF} CONTROL · a building with no inputs shows no Runs-on block',
    r.noInput ? r.noInput.hasRunsOn === false : false, r.noInputType);
}

console.log('\npage errors: ' + errs.length); errs.slice(0, 5).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
