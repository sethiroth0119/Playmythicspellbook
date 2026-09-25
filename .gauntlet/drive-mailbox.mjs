/* 📮 MAILBOX DRIVER — the corp activity feed, driven in a real browser.
   The parse gates only prove screens.jsx parses; this renders it.

   public/ is served over loopback and public/corp/index.html is opened for
   real (React + Babel still come from unpkg — the CDN <script> tags carry SRI
   hashes and swapping them for node_modules copies is rejected SILENTLY,
   giving a blank page with a clean console, so they are left alone).

   The bridge is stubbed the same way the game drives it: set window.__JB.econ
   and dispatch 'jbdata'. That is the exact seam _jbridge.js writes through, so
   nothing here is a private back door into the screen.

   node .gauntlet/drive-mailbox.mjs                                          */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const PORT = 8790 + (process.pid % 60);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let bad = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ↳ ' + extra : ''));
  if (!ok) bad++;
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:' + PORT + '/corp/index.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.sidebar', { timeout: 30000 });
chk('the corp app mounted at all (CDN React/Babel reachable)', await page.locator('.sidebar').count() === 1);

// ── the fixture. Shaped exactly like econ.corpActivity from _jbActivityFetch,
//    with entries that came out of the executed bridge test.
const FEED = [
  { id: 'treasury:t1', src: 'treasury', at: '2026-08-21T12:00:00.000Z', actor: 'Sethiroth', verb: 'deposited to the Treasury', object: 'member deposit', icon: '🔥', amount: 25000, unit: 'Cinder', qty: null, note: '', dir: 1 },
  { id: 'vault:v2',    src: 'vault',    at: '2026-08-21T11:00:00.000Z', actor: 'Marrow',    verb: 'withdrew from the vault',  object: 'Iron', icon: '⛓', qty: -15, unit: '', amount: null, note: '', dir: -1 },
  { id: 'vault:v1',    src: 'vault',    at: '2026-08-21T10:00:00.000Z', actor: 'Sethiroth', verb: 'deposited into the vault', object: 'Iron', icon: '⛓', qty: 40,  unit: '', amount: null, note: '', dir: 1 },
  { id: 'treasury:t2', src: 'treasury', at: '2026-08-21T08:00:00.000Z', actor: 'Marrow',    verb: 'paid worker wages', object: 'mining wages', icon: '🔥', amount: -3400, unit: 'Cinder', qty: null, note: '', dir: -1 },
  /* ⚠ NO `status` on transfer / request rows. The bridge stopped shipping it:
     the verb is BUILT from the status, so the chip printed the same word a
     second time ("was hired [hired]"). Keeping it in this fixture would test
     a shape the bridge no longer produces — a driver passing on data the real
     source cannot emit is worse than no driver. Operations keep theirs. */
  { id: 'transfer:x1', src: 'transfer', at: '2026-08-21T06:00:00.000Z', actor: 'Sethiroth', verb: 'sent to Marrow', object: 'Fuel', icon: '⛽', qty: 12, unit: '', amount: null, note: '', dir: 0 },
  /* 🔢 The two rows that catch a money formatter being used on a count, and a
     null being printed as a 0. fmt() (built for prices) renders 0 as "0.00",
     so a zero-quantity ledger row read "0.00" — a decimal place on a count of
     objects. And a NULL treasury amount must print NOTHING: a 0 would be a
     claim that the row moved nothing, which is a different fact.
     ⚠ Kept in DESCENDING `at` order with the rest: the screen does not sort,
     the bridge does, so a fixture out of order would test a state the screen
     can never actually be handed. */
  { id: 'vault:v0',    src: 'vault',    at: '2026-08-21T05:30:00.000Z', actor: 'Marrow', verb: 'deposited into the vault', object: 'Scrap', icon: '⛓', qty: 0, unit: '', amount: null, note: '', dir: 0 },
  { id: 'treasury:t0', src: 'treasury', at: '2026-08-21T05:00:00.000Z', actor: 'Marrow', verb: 'Treasury refund', object: 'reversal pending', icon: '🔥', amount: null, unit: 'Cinder', qty: null, note: '', dir: 0 },
  { id: 'request:r1',  src: 'request',  at: '2026-08-21T04:00:00.000Z', actor: 'Vane', verb: 'applied to the corporation', object: 'as Quartermaster', icon: '👥', qty: null, amount: null, unit: '', note: '', dir: 0 },
  { id: 'operation:o1',src: 'operation',at: '2026-08-20T04:00:00.000Z', actor: 'Ashford & Keel', verb: 'founded this business', object: 'Warehouse', icon: '🏭', qty: null, amount: null, unit: '', status: 'active', note: '', dir: 0 },
];
const ECON = (activity, loaded, corp) => ({
  cinders: 1000, aza: 0, mt: 0, wallet: null, handle: 'Sethiroth', signedIn: true,
  corp: corp === undefined ? { id: 'corp-1', name: 'Ashford & Keel', tag: 'AK', role: 'founder' } : corp,
  corpChecked: true, roster: [], requests: [], pendingHires: [], vault: [], transfers: [],
  corps: [], resources: [], operations: [], corpActivity: activity, corpActivityLoaded: loaded,
  guildChat: [], legalCases: [], agencyListings: [], realEstateListings: [],
});
const push = (econ) => page.evaluate((e) => {
  window.__JB.econ = e; window.__JB.ready = true;
  window.dispatchEvent(new Event('jbdata'));
}, econ);
const openMail = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.sidebar .nav button')].find(x => /Mailbox/.test(x.textContent));
  b && b.click();
});
const mailBadge = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.sidebar .nav button')].find(x => /Mailbox/.test(x.textContent));
  const s = b && b.querySelector('.badge');
  return s ? s.textContent.trim() : null;
});
const clearSeen = () => page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

// ══ 1. THE BADGE at zero ══════════════════════════════════════════════════
await clearSeen();
await push(ECON([], true));
await page.waitForTimeout(200);
chk('empty feed → NO mailbox badge at all (the old one was a hardcoded 2)',
    (await mailBadge()) === null, 'badge = ' + JSON.stringify(await mailBadge()));

// ══ 2. THE BADGE = rows newer than the last-seen mark ═════════════════════
await push(ECON(FEED, true));
await page.waitForTimeout(250);
chk(FEED.length + ' unseen entries → badge reads ' + FEED.length,
    (await mailBadge()) === String(FEED.length), 'badge = ' + await mailBadge());

// mark seen up to the 4th-newest, exactly as the screen does
await page.evaluate(() => { localStorage.setItem('jb.mail.seen.corp-1', '2026-08-21T08:00:00.000Z'); window.dispatchEvent(new Event('jb:mailseen')); });
await page.waitForTimeout(200);
chk('mark seen at the 4th entry → badge drops to 3 (the three above the mark)',
    (await mailBadge()) === '3', 'badge = ' + await mailBadge());

// ══ 3. THE SCREEN ═════════════════════════════════════════════════════════
await clearSeen();
await push(ECON(FEED, true));
await openMail();
await page.waitForTimeout(400);
const rows = await page.evaluate(() => [...document.querySelectorAll('.screen .card > .row')]
  .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
console.log('\n   ── rendered rows ──');
rows.forEach(r => console.log('   ' + r));
console.log('');
chk('every feed entry rendered exactly one row', rows.length === FEED.length, rows.length + ' rows for ' + FEED.length + ' entries');
chk('a treasury deposit shows its real actor, note and +25,000 Cinder',
    /Sethiroth/.test(rows[0]) && /member deposit/.test(rows[0]) && /\+25,000 Cinder/.test(rows[0]), rows[0]);
chk('a vault WITHDRAWAL shows -15 (its own sign), not 15', /-15/.test(rows[1]) && !/\+15/.test(rows[1]), rows[1]);
chk('a vault DEPOSIT shows +40', /\+40/.test(rows[2]), rows[2]);
chk('a wage line keeps its own negative sign', /-3,400 Cinder/.test(rows[3]), rows[3]);
chk('a member transfer prints a bare quantity — no invented sign', /12/.test(rows[4]) && !/[+]12|-12/.test(rows[4]), rows[4]);
/* 🔢 The formatter checks. fmt() is the app's PRICE formatter and renders 0 as
   "0.00"; counts go through vaultNum() and Cinder through fmtC(), the same
   integer formatter the Corp Treasury headline uses — the Mailbox's Treasury
   lines are the individual terms of that headline's sum(amount), so a
   different formatter would make them visibly fail to add up to it. */
// textContent runs the cells together, so the value is simply the tail.
chk('a zero-quantity vault row prints "0", not the price formatter\'s "0.00"',
    /Scrap0$/.test(rows[5]) && !/0\.00/.test(rows[5]), rows[5]);
chk('a treasury row with a NULL amount prints NO number at all (not 0)',
    !/\d/.test(rows[6].replace(/\d+[smhd] ago/, '')) , rows[6]);
chk('an application prints its verb and NO number and NO duplicate status chip',
    /applied to the corporation/.test(rows[7]) &&
    !/pending/.test(rows[7]) &&
    !/[0-9]/.test(rows[7].replace(/\d+[smhd] ago/, '')), rows[7]);
chk('a founded business names the real operation and keeps its own status chip',
    /Warehouse/.test(rows[8]) && /active/.test(rows[8]), rows[8]);

// backwards vs forwards is coloured from the row's own sign
await page.screenshot({ path: '.gauntlet/shots/mailbox.png' }).catch(() => {});
const tones = await page.evaluate(() => [...document.querySelectorAll('.screen .card > .row')]
  .map(r => { const s = r.querySelector('span.mono:last-child'); return s ? getComputedStyle(s).color : null; }));
chk('forward and backward rows are coloured differently, from their own sign',
    tones[0] && tones[1] && tones[0] !== tones[1], 'deposit ' + tones[0] + ' vs withdrawal ' + tones[1]);

// the dead controls are gone
const body = await page.evaluate(() => document.querySelector('.main').textContent);
chk('"Claim all" is gone', !/Claim all/.test(body));
chk('"Mark all read" is gone', !/Mark all read/.test(body));
chk('"Return" / "Reject" / "Accept & claim" are gone', !/Accept & claim|Reject/.test(body));
// The demo-callsign branch itself, not the word: the replacement's header
// comment names WRAITH-9 to record what was removed and why.
{
  const s = fs.readFileSync('public/corp/screens.jsx', 'utf8');
  chk('the WRAITH-9 demo branch is gone from the source', !/includes\(\s*['"]WRAITH-9/.test(s));
  chk('window.ECON.MAIL is no longer read by the Mailbox', !/function MailboxScreen\(\{/.test(s));
}
chk('no boilerplate attachment/expiry paragraph is printed', !/expiry in 7 days|confirm receipt/i.test(body));

// opening the mailbox clears the badge
await page.waitForTimeout(200);
chk('opening the Mailbox marks the feed seen → badge clears', (await mailBadge()) === null, 'badge = ' + JSON.stringify(await mailBadge()));

// ══ 4. DEGRADATION ════════════════════════════════════════════════════════
await push(ECON([], true));
await page.waitForTimeout(300);
let txt = await page.evaluate(() => document.querySelector('.main').textContent);
chk('empty feed → ONE honest empty state, no fabricated rows',
    /Nothing yet/.test(txt) && /Ashford & Keel/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 150));

await push(ECON([], false, null));   // no corporation at all
await page.waitForTimeout(300);
txt = await page.evaluate(() => document.querySelector('.main').textContent);
chk('no corporation → its own honest state, not a spinner',
    /No corporation/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 120));

// the bridge absent entirely (offline / opened standalone)
await page.evaluate(() => { window.__JB.econ = null; window.dispatchEvent(new Event('jbdata')); });
await page.waitForTimeout(300);
txt = await page.evaluate(() => document.querySelector('.main').textContent);
chk('bridge absent entirely → still renders, still no throw', txt.length > 0 && /No corporation/.test(txt));

// one source missing is a BRIDGE property, but the screen must survive rows
// whose optional fields are simply absent
await push(ECON([{ id: 'x', src: 'vault', at: '2026-08-21T12:00:00.000Z' }], true));
await page.waitForTimeout(300);
txt = await page.evaluate(() => document.querySelector('.main').textContent);
chk('a row with NO actor/object/qty prints no NaN and no undefined',
    !/NaN|undefined|null/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));

// ══ 5. THE REAL BRIDGE OUTPUT, RENDERED ═══════════════════════════════════
/* Everything above renders a hand-written fixture, which only proves the
   screen draws what it is given. This stage runs .gauntlet/exec-corpactivity
   — which lifts the REAL _jbActivityFetch() out of index.html and executes it
   over rows copied from the production tables, plus one vault deposit, one
   vault withdrawal and one treasury deposit — and renders THAT array. So the
   three movements are checked all the way from the row shape the write paths
   insert, through the real merge, to the pixels. */
{
  const os = await import('node:os');
  const cp = await import('node:child_process');
  const tmp = path.join(os.tmpdir(), 'jb-feed-' + process.pid + '.json');
  const r = cp.spawnSync(process.execPath, [path.join('.gauntlet', 'exec-corpactivity.mjs')],
    { env: { ...process.env, ACT_OUT: tmp }, encoding: 'utf8' });
  chk('the bridge harness itself passes (exec-corpactivity.mjs)', r.status === 0,
      (r.stdout || '').trim().split('\n').pop());
  const REAL = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  await clearSeen();
  /* ⚠ LEAVE THE MAILBOX FIRST. Stage 3 left the screen mounted, and a mounted
     Mailbox marks the feed seen the instant new entries arrive — which is
     correct (the player is looking at them) and made this stage read a null
     badge on its first run. The badge is a claim about a player who was
     SOMEWHERE ELSE when the three movements happened, so drive it that way. */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sidebar .nav button')].find(x => !/Mailbox/.test(x.textContent));
    b && b.click();
  });
  await page.waitForTimeout(150);
  // The mark sits just under the three movements, exactly as it would for a
  // player whose last visit was before they happened.
  await page.evaluate((m) => localStorage.setItem('jb.mail.seen.corp-1', m), REAL[3].at);
  await push(ECON(REAL, true));
  await page.waitForTimeout(250);
  chk('badge reads 3 for the three movements made since the last visit',
      (await mailBadge()) === '3', 'badge = ' + await mailBadge());
  await openMail();
  await page.waitForTimeout(400);
  const real = await page.evaluate(() => [...document.querySelectorAll('.screen .card > .row')]
    .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  console.log('\n   ── top of the REAL bridge output, as rendered ──');
  real.slice(0, 4).forEach(r => console.log('   ' + r));
  console.log('');
  chk('every bridge entry became exactly one row', real.length === REAL.length, real.length + ' of ' + REAL.length);
  chk('vault deposit renders +25 Iron for the real depositor',
      /Sethiroth/.test(real[0]) && /deposited into the vault/.test(real[0]) && /Iron/.test(real[0]) && /\+25\b/.test(real[0]), real[0]);
  chk('vault withdrawal renders -10 Iron for the real member',
      /Keevan M/.test(real[1]) && /withdrew from the vault/.test(real[1]) && /-10\b/.test(real[1]), real[1]);
  chk('treasury deposit renders +5,000 Cinder for the real member',
      /Mavric/.test(real[2]) && /\+5,000 Cinder/.test(real[2]), real[2]);
  chk('no NaN / undefined / [object Object] in the whole rendered feed',
      !/NaN|undefined|\[object Object\]/.test(real.join(' ')));
  // The orphaned-actor row: a real ledger line whose author left the corp.
  chk('an orphaned actor renders a short id, never a placeholder name',
      real.some(r => /#deadbeef/.test(r)) && !real.some(r => /\bMember\b/.test(r)));
  await page.screenshot({ path: '.gauntlet/shots/mailbox-real.png' }).catch(() => {});
}

// ── reachability: the door ────────────────────────────────────────────────
chk('the Mailbox is reachable from the sidebar', await page.evaluate(() =>
  !![...document.querySelectorAll('.sidebar .nav button')].find(x => /Mailbox/.test(x.textContent))));

chk('no uncaught page errors during the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: '.gauntlet/shots/mailbox-degraded.png' }).catch(() => {});
await browser.close();
server.close();
console.log('\n' + (bad ? '❌ ' + bad + ' failed' : '✅ all checks passed'));
process.exit(bad ? 1 : 0);
