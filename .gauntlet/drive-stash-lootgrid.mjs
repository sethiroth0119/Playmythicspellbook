/* ══════════════════════════════════════════════════════════════════════════
   🔒 DRIVE-STASH-LOOTGRID — the stash beside the bag, where the decision is

   The Secret Stash was built into the Bag Upgrades shop and NOWHERE ELSE. So
   the one screen where "what do I risk, what do I protect" is actually being
   decided — the salvage loot grid — did not show it at all. A protected slot
   you cannot reach while looting is a protected slot that does not exist.

   ⚠ IT DRIVES THE REAL MODAL. _lootGridOpen() is called on the live page and
     the assertions read the DOM it built and the Profile it committed. The
     stash functions it depends on (_stashCap, _stashLocked, _ensureStash) are
     top-level bindings in index.html, so this cannot be done from a copy.

   ⚠ THE CHECK I CARE MOST ABOUT IS THE DESTRUCTIVE ONE. Committing writes
     Profile.secretStash. If the stash is locked or absent, that write MUST NOT
     happen — otherwise opening a salvage screen would erase everything a
     player had protected, which is worse than the missing feature. There is a
     dedicated control for it below.

   Run:  node .gauntlet/drive-stash-lootgrid.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9400 + Math.floor(Math.random() * 500);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof _lootGridOpen === "function" && typeof _stashCap === "function"',
  null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const reachable = await pg.evaluate(() => typeof _lootGridOpen === 'function');
if (!reachable) {
  console.error('FATAL: _lootGridOpen is not reachable — cannot drive the real modal.');
  await b.close(); srv.close(); process.exit(1);
}

/* ── A. UNLOCKED — the stash is on screen and takes salvage ─────────────── */
const unlocked = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  Profile.stashTier = 2;                       // 12 protected slots
  Profile.secretStash = { metal: 2 };
  Profile.fieldBag = { wood: 2 };
  _lootGridOpen({ metal: 4, stone: 2, cloth: 2 }, { tombName: 'Ruined Hospital', icon: '🏥' });
  await sleep(350);
  const cols = Array.from(document.querySelectorAll('#lg-body .lg-col'));
  const o = {
    columns: cols.length,
    titles: cols.map(c => (c.querySelector('.lg-title') || {}).textContent || '').map(t => t.trim()),
    stashIsDropTarget: !!document.querySelector('[data-lg-wrap="stash"]'),
    stashCells: (_LG.stash ? _LG.stash.pieces.reduce((a, p) => a + p.w * p.h, 0) : -1),
    stashCap: _LG.stash ? _LG.stash.slotCap : -1,
    declaredCap: _stashCap(),
    lockedCardShown: !!document.querySelector('.lg-lockcard'),
  };
  // The stash grid must have been seeded from the REAL Profile.secretStash.
  o.seededFromProfile = (_LG.stash.pieces || []).some(p => p.resId === 'metal');
  return o;
});

/* ── B. THE SLOT CAP IS ENFORCED WHERE THE PLAYER CAN SEE IT ────────────── */
const capTest = await pg.evaluate(() => {
  // Tier 1 = 7 slots, but a 6-wide grid draws 12 cells. The surplus must be
  // refused by _lgCanPlace, not honoured.
  const g = { id: 'stash', cols: 6, rows: 2, pieces: [], slotCap: 7 };
  const mk = (w, h, uid) => ({ uid, resId: 'metal', qty: 1, w, h, rot: 0, x: 0, y: 0 });
  const a = mk(3, 2, 'a');                       // 6 cells
  const okFirst = _lgAutoPlace(g, a);
  const b2 = mk(2, 1, 'b');                      // +2 → 8 > 7, must be refused
  const refused = !_lgCanPlace(g, b2, 3, 0);
  const c = mk(1, 1, 'c');                       // +1 → 7, exactly the cap
  const allowed = _lgCanPlace(g, c, 3, 0);
  // CONTROL: a grid with NO slotCap must accept it — proving the refusal came
  // from the cap and not from geometry.
  const g2 = { id: 'bag', cols: 6, rows: 2, pieces: [], slotCap: null };
  _lgAutoPlace(g2, mk(3, 2, 'a2'));
  const uncapped = _lgCanPlace(g2, mk(2, 1, 'b2'), 3, 0);
  return { okFirst, refused, allowed, uncapped, cells: g.pieces.reduce((s, p) => s + p.w * p.h, 0) };
});

/* ── C. COMMIT — protected loot lands in Profile.secretStash ────────────── */
const commit = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Move one loot piece into the stash grid by hand, the way a drag ends.
  const p = _LG.loot.pieces.find(x => x.fromLoot);
  const resId = p && p.resId;
  const i = _LG.loot.pieces.indexOf(p);
  _LG.loot.pieces.splice(i, 1);
  _lgAutoPlace(_LG.stash, p);
  document.getElementById('lg-close').click();
  await sleep(400);
  return {
    resId,
    stashAfter: JSON.parse(JSON.stringify(Profile.secretStash || {})),
    bagAfter: JSON.parse(JSON.stringify(Profile.fieldBag || {})),
    modalGone: !document.getElementById('lg-overlay'),
  };
});

/* ── D. LOCKED — the card shows, and NOTHING is written ─────────────────── */
const locked = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  Profile.stashTier = 0;                                  // no stash owned
  /* 🔴 THE CONTROL THAT MATTERS. A player with protected items who then loses
     their stash tier (or opens the screen in a build where the stash is not
     drawn) must NOT have Profile.secretStash overwritten with {}. */
  Profile.secretStash = { metal: 9, cloth: 3 };
  const before = JSON.parse(JSON.stringify(Profile.secretStash));
  Profile.fieldBag = {};
  _lootGridOpen({ stone: 2 }, { tombName: 'Ruined Hospital', icon: '🏥' });
  await sleep(350);
  const cardShown = !!document.querySelector('.lg-lockcard');
  const noStashGrid = !document.querySelector('[data-lg-wrap="stash"]');
  const pointsAtShop = /Vendor Market/i.test(document.body.innerText || '');
  document.getElementById('lg-close').click();
  await sleep(400);
  return { before, after: JSON.parse(JSON.stringify(Profile.secretStash || {})),
           cardShown, noStashGrid, pointsAtShop };
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F512} SECRET STASH · BESIDE THE BAG, WHERE THE DECISION IS MADE\n');

console.log('  ── with a stash owned');
ok('\u{1F3AF} the salvage screen now has THREE grids', unlocked.columns === 3,
  unlocked.columns + ': ' + JSON.stringify(unlocked.titles));
ok('\u{1F3AF} one of them is the Secret Stash',
  unlocked.titles.some(t => /Secret Stash/i.test(t)), JSON.stringify(unlocked.titles));
ok('\u{1F3AF} and it is a real drop target', unlocked.stashIsDropTarget === true);
ok('it was seeded from the player’s actual stash', unlocked.seededFromProfile === true);
ok('its cap is the tier’s cap, not the grid’s',
  unlocked.stashCap === unlocked.declaredCap, unlocked.stashCap + ' vs ' + unlocked.declaredCap);
ok('no locked card while it is owned', unlocked.lockedCardShown === false);

console.log('\n  ── the paid capacity is not quietly rounded up');
ok('CONTROL · the first piece fits', capTest.okFirst === true);
ok('\u{1F3AF} a piece that would exceed 7 slots is REFUSED', capTest.refused === true);
ok('\u{1F3AF} one that lands exactly on 7 is allowed', capTest.allowed === true);
ok('\u{1F3AF} CONTROL · the same piece in an UNCAPPED grid is accepted',
  capTest.uncapped === true, 'so the refusal came from the cap, not the geometry');

console.log('\n  ── committing');
ok('\u{1F3AF} salvage dragged to the stash reaches Profile.secretStash',
  (commit.stashAfter[commit.resId] | 0) > 0, JSON.stringify(commit.stashAfter));
ok('the bag still committed too', Object.keys(commit.bagAfter).length > 0, JSON.stringify(commit.bagAfter));
ok('the modal closed', commit.modalGone === true);

console.log('\n  ── CONTROL · no stash owned');
ok('\u{1F3AF} a locked card is shown instead of a grid', locked.cardShown === true);
ok('\u{1F3AF} …and it is NOT a drop target', locked.noStashGrid === true);
ok('it says where to buy one', locked.pointsAtShop === true);
ok('\u{1F3AF}\u{1F534} PROTECTED ITEMS ARE NOT ERASED',
  JSON.stringify(locked.before) === JSON.stringify(locked.after),
  JSON.stringify(locked.before) + ' -> ' + JSON.stringify(locked.after));

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
