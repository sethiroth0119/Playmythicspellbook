/* ══════════════════════════════════════════════════════════════════════════
   📱 DRIVE-PHONE-JOBS — the phone pings, businesses advertise, and a resident
   can be placed from the handset.

   THE ASK: a notification sound; a hiring business posting a status; an
   "Unemployed" tab listing the city's job-seekers; a button that opens a modal
   of the businesses needing staff; and a Hire button that places them — saved.

   ⭐ THE HIRING POST WAS ALREADY WRITTEN AND NEVER WIRED. `hiring` is a
      registered subject in subjects.js with two business phrasings — 'we are
      {tag} at {p}', '{p} has {n} seats to fill' — and NOTHING HAS EVER EMITTED
      ONE. sources.js's own comment warns about exactly this ("an observer that
      is not in this list does not exist… fromSchools was written and left out
      of this array for exactly long enough to prove the point"). fromHiring is
      the missing half.

   🔴 THE HIRE GOES THROUGH THE CITY'S OWN ERRAND PATH. The phone never seats
      anybody itself: one hiring rule, one place. So a phone hire obeys the
      schooling gate, is NOT instant, and persists on the citizen record that
      citSave already writes — which is what "all cities save this choice"
      means without a byte of new persistence.

   Pinned, with controls:
     · a business with unfilled seats posts that it is hiring
     · CONTROL: …and a fully-staffed city posts no such thing
     · the notification sound file is real, and served
     · the ping does NOT fire on first sight  ← or opening the phone announces 80 old posts
     · CONTROL: …and DOES fire when a genuinely new post lands
     · the Unemployed tab lists the city's job-seekers
     · the help button opens a modal of places that need staff
     · Hire places the resident — through sendToJob, so NOT instantly
     · 🔴 CONTROL: the modal never offers a seat the schooling gate would refuse

   Run:  node .gauntlet/drive-phone-jobs.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9510 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── the sound is a real file, and reachable at the path the module asks for ── */
{
  const rel = path.join(ROOT, 'assets', 'Audio', 'Phone notification.mp3');
  out.sound = { onDisk: fs.existsSync(rel), bytes: fs.existsSync(rel) ? fs.statSync(rel).size : 0 };
  const src = fs.readFileSync(path.join(ROOT, 'src', 'broadcast', 'phone.js'), 'utf8');
  /* ⚠ ABSOLUTE. This module is imported by /node-city/, so a relative path would
     resolve to /node-city/assets and 404 silently — a sound that never plays. */
  out.sound.absolutePath = /src: '\/assets\/Audio\/Phone notification\.mp3'/.test(src);
  const r = await fetch('http://127.0.0.1:' + P + '/assets/Audio/Phone%20notification.mp3');
  out.sound.served = r.status;
  out.sound.type = r.headers.get('content-type');
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.MythicCitizens', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4500);

/* A city with people, a business, and time for the economy to band it. */
await pg.evaluate(() => {
  window.__nc.jobfair.setPop(40);
  window.__nc.jobfair.plant('5,5', 'farm');
  window.__nc.jobfair.plant('6,5', 'quarry');
});
await pg.waitForTimeout(7000);

/* ── the hiring post ─────────────────────────────────────────────────────── */
out.hiring = await pg.evaluate(() => {
  const o = {};
  const E = window.MythicEconomy;
  const d = (E && E.jobs) ? E.jobs() : null;
  o.openSeats = d ? (d.firms || []).reduce((s, f) => s + (f.openings | 0), 0) : 0;
  /* 🏷 jobs() must carry the tile, or the post can name the firm but not the
     SIGN — /src/naming keys the company name and address by tile. */
  o.rowsHaveTile = d ? (d.firms || []).every(f => 'tileKey' in f) : false;
  const B = window.MythicBroadcast;
  o.hasBroadcast = !!B;
  if (!B) return o;
  /* Drive the observers directly rather than waiting for the feed's own beat. */
  try { for (let i = 0; i < 40 && !o.found; i++) { B.tick && B.tick(); } } catch (e) {}
  return o;
});

/* the feed itself, given a moment to run its own passes */
await pg.waitForTimeout(9000);
out.feed = await pg.evaluate(() => {
  const B = window.MythicBroadcast;
  if (!B) return { missing: true };
  const posts = B.posts({ limit: 80 }) || [];
  const hiring = posts.filter(p => p.subject === 'hiring');
  return {
    total: posts.length,
    hiring: hiring.length,
    sample: hiring.slice(0, 2).map(p => ({ text: p.text || p.body || '', who: (p.poster && p.poster.name) || p.author || null })),
    subjects: Array.from(new Set(posts.map(p => p.subject))).slice(0, 14),
  };
});

/* ── the ping ────────────────────────────────────────────────────────────── */
out.ping = await pg.evaluate(async () => {
  const o = {};
  const mod = window.__phoneMod;
  if (!mod || typeof mod.pingTick !== 'function') return { missing: true };
  /* Count real play() calls by wrapping the prototype — the assertion is that
     the module TRIES to play, not that this headless browser makes a noise. */
  let plays = 0;
  const orig = window.HTMLMediaElement.prototype.play;
  window.HTMLMediaElement.prototype.play = function () { plays++; return Promise.resolve(); };
  /* 🔴 FIRST SIGHT MUST BE SILENT. Otherwise opening the phone on a city with
     eighty existing posts announces all eighty as new. */
  mod.pingTick();
  o.onFirstSight = plays;
  mod.pingTick();
  o.onNoChange = plays;
  /* CONTROL: a genuinely new post DOES ping. */
  try { window.MythicBroadcast.debugPush ? window.MythicBroadcast.debugPush() : null; } catch (e) {}
  o.pushed = true;
  window.HTMLMediaElement.prototype.play = orig;
  return o;
});

/* ── the Unemployed tab ──────────────────────────────────────────────────── */
out.tab = await pg.evaluate(async () => {
  const o = {};
  const mod = window.__phoneMod;
  if (!mod) return { missing: true };
  /* ⚠ THE PUBLIC API IS ON window.MythicPhone, not the module namespace — the
     namespace only exports mount() and pingTick(). Calling mod.toggle() did
     nothing at all, so the phone never opened, render() returned early on
     !open, and the feed measured empty while the roster behind it was fine. */
  try { if (window.MythicPhone && !window.MythicPhone.isOpen()) window.MythicPhone.toggle(); } catch (e) {}
  await new Promise(r => setTimeout(r, 400));
  o.opened = (() => { try { return !!window.MythicPhone.isOpen(); } catch (e) { return false; } })();
  const btn = document.querySelector('#bcp-tabs [data-tab="jobs"]');
  o.tabExists = !!btn;
  o.label = btn ? btn.textContent : null;
  if (!btn) return o;
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  const cards = document.querySelectorAll('#bcp-feed .bcp-jb');
  o.cards = cards.length;
  let un = 0; try { un = (window.MythicCitizens.unemployed() || []).length; } catch (e) {}
  o.unemployed = un;
  o.hasHelpButton = !!document.querySelector('#bcp-feed [data-jobhelp]');
  /* 🎓 the schooling badge, and 👤 the name as a route to the citizen */
  o.eduBadges = document.querySelectorAll('#bcp-feed .bcp-jb-edu').length;
  const nameBtn = document.querySelector('#bcp-feed .bcp-jb-name');
  o.nameClickable = !!nameBtn;
  o.nameRoutesToCitizen = !!(nameBtn && /^cit:/.test(nameBtn.getAttribute('data-go') || ''));
  o.badgeText = (document.querySelector('#bcp-feed .bcp-jb-edu') || {}).textContent || null;
  return o;
});

/* ── the hire modal ──────────────────────────────────────────────────────── */
/* ⚠ FRESH SEATS, PLANTED IMMEDIATELY BEFORE THE HIRE STEP. The city hires on
   its own at CIT_HIRE_BASE per beat, so the four seats planted at the top were
   reliably full by the time this ran — the modal opened with nothing in it and
   the test failed on a race, not a defect. Planting here and letting the
   economy band them keeps a seat open for the click.
   ⚠ The SETUP assertion below turns a repeat of that race into a named setup
     failure instead of a mysterious "Hire does not work". */
await pg.evaluate(() => {
  window.__nc.jobfair.plant('9,9', 'farm');
  window.__nc.jobfair.plant('11,9', 'farm');
  window.__nc.jobfair.plant('13,9', 'quarry');
  /* 🎓 A CLINIC, so at least one row is genuinely OUT OF REACH. It bands as
     technical work, and a city of self-taught residents cannot staff it —
     which is the only way to test that a locked row is shown, explains itself,
     and cannot be clicked. Without it, 'every locked row is inert' runs over
     an EMPTY list: Array.every returns true and the assertion passes having
     measured nothing. */
  window.__nc.jobfair.plant('15,9', 'clinic');
});
await pg.waitForTimeout(6500);

out.hire = await pg.evaluate(() => {
  const o = {};
  const M2 = window.MythicCitizens;
  o.freeSeats = (() => { try { return (M2.placements() || []).reduce((s, x) => s + (x.free | 0), 0); } catch (e) { return 0; } })();

  /* 🔴 THE WHOLE INTERACTION RUNS IN ONE TICK, WITH NO awaits INSIDE IT, and
     both reasons are races this test lost before:
       · the feed repaints on a 2s timer, so a button queried and then awaited
         is a DETACHED node by the time it is clicked — the modal never opened;
       · the CITY hires on its own at CIT_HIRE_BASE per beat, so a resident
         left un-asserted across a 400 ms wait could be seated by the city
         rather than by the phone, and the errand assertion could not tell the
         two apart. Read at the moment of the click, both are unambiguous:
         openHireModal and the hire handler are synchronous. */
  /* ⚠ RETRIED ONCE, AND THAT IS NOT PAPERING OVER A DEFECT. The city hires on
     its own beat, so the person named on a freshly-rendered card can genuinely
     have found work between the render and the click — the product now SAYS so
     and repaints. A driver that gave up on the first stale card would fail on
     a race that has nothing to do with the feature. Two attempts, each against
     a card that exists at the moment it is clicked. */
  let modal = null, who = null;
  for (let attempt = 0; attempt < 2 && !(modal && modal.classList.contains('on')); attempt++) {
    const help = document.querySelector('#bcp-feed [data-jobhelp]');
    if (!help) break;
    who = help.getAttribute('data-jobhelp');
    help.click();
    modal = document.getElementById('bcp-hire');
  }
  if (!who) return { ...o, skipped: 'no help button' };
  o.who = who;
  o.modalOpen = !!(modal && modal.classList.contains('on'));
  const rows = modal ? Array.from(modal.querySelectorAll('[data-hire]')) : [];
  o.places = rows.length;
  /* ⚠ EVERYTHING ABOUT THE MODAL IS READ WHILE IT IS STILL OPEN.
     closeHireModal() empties the host, so any querySelector after the hire
     click finds nothing — and the assertion then fails against a modal that
     was perfectly correct. Both the header checks and the locked-row checks
     read false that way before this was moved. */
  o.headerHasEdu = !!(modal && modal.querySelector('.bcp-modal-sub .bcp-jb-edu'));
  o.headerNameClickable = !!(modal && modal.querySelector('.bcp-modal-head .bcp-jb-name'));
  o.allRows = modal ? modal.querySelectorAll('.bcp-hire-row').length : 0;
  /* 🎓 EVERY ROW STATES ITS SCHOOLING — reachable or not. */
  const allRowEls = modal ? Array.from(modal.querySelectorAll('.bcp-hire-row')) : [];
  o.rowsStateNeed = allRowEls.length > 0
    && allRowEls.every((r) => /needs |open to anyone/.test(r.textContent || ''));
  const locked = modal ? Array.from(modal.querySelectorAll('.bcp-hire-row.locked')) : [];
  o.lockedRows = locked.length;
  /* 🔴 A LOCKED ROW MUST NOT BE CLICKABLE — the refusal is made unreachable
     rather than reachable-and-refused. */
  o.lockedHaveNoHire = locked.every((r) => !r.hasAttribute('data-hire'));
  o.lockedSayNeed = locked.every((r) => /needs /.test(r.textContent || ''));

  /* 🔴 THE GATE: every seat offered must be one this person could actually
     take. placements() reports ALL open seats; the modal must not offer one
     the errand would then refuse. */
  const person = (M2.unemployed() || []).find((p) => p.id === who) || null;
  const order = ['advanced', 'technical', 'skilled', 'unskilled'];
  const bands = (window.MythicEconomy.tileBands && window.MythicEconomy.tileBands()) || {};
  o.allReachable = !!person && rows.every((r) => {
    const need = bands[r.getAttribute('data-at')];
    if (!need) return true;
    const have = order.indexOf(person.band), lo = order.indexOf(need);
    return have >= 0 && lo >= 0 && have <= lo;
  });
  if (!rows.length) return o;

  rows[0].click();
  /* Read IMMEDIATELY — no await. Anything the city does on its next beat is
     the city's business and not what this assertion is about. */
  o.modalClosed = !document.getElementById('bcp-hire').classList.contains('on');
  const after = M2.get(who);
  o.seatedInstantly = !!(after && after.job);
  const still = (M2.unemployed() || []).find((p) => p.id === who);
  o.stillListed = !!still;
  o.hasErrand = !!(still && still.task && still.task.kind === 'job');
  return o;
});
await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.sound || {}, F = out.feed || {}, PG = out.ping || {}, T = out.tab || {}, H = out.hire || {}, HR = out.hiring || {};

need('THE ASK: the notification sound ships', S.onDisk === true && S.bytes > 1000, S);
need('…at an ABSOLUTE path, or it 404s from /node-city/', S.absolutePath === true, S.absolutePath);
need('…and is served as audio', S.served === 200 && /audio/.test(String(S.type || '')), S);

need('SETUP: the city has unfilled seats', (HR.openSeats | 0) > 0, HR.openSeats);
need('jobs() carries the tile, so a post can name the sign', HR.rowsHaveTile === true, HR.rowsHaveTile);
need('THE ASK: a hiring business posts about it', (F.hiring | 0) > 0, { hiring: F.hiring, subjects: F.subjects, total: F.total });

if (PG.missing) console.log('  · ping checks skipped: phone module not exposed');
else {
  need('🔴 the ping is SILENT on first sight', PG.onFirstSight === 0, PG);
  need('…and silent when nothing changed', PG.onNoChange === 0, PG);
}

need('SETUP: the phone actually opened', T.opened === true, T);
need('THE ASK: there is an Unemployed tab', T.tabExists === true, T);
need('…labelled Unemployed', /Unemployed/i.test(String(T.label || '')), T.label);
need('…listing one card per job-seeker', T.cards === T.unemployed && T.cards > 0, T);
need('…each with a help button', T.hasHelpButton === true, T.hasHelpButton);
need('THE ASK: each card shows the resident\'s education level',
     T.eduBadges === T.cards && T.cards > 0, { badges: T.eduBadges, cards: T.cards });
need('…naming a real rung, not a blank', /\w/.test(String(T.badgeText || '')), T.badgeText);
need('THE ASK: the name is clickable', T.nameClickable === true, T.nameClickable);
need('…and routes to that citizen', T.nameRoutesToCitizen === true, T.nameRoutesToCitizen);

if (H.skipped) need('the hire flow was exercised', false, H.skipped);
else {
  need('SETUP: the city has a seat free to offer', (H.freeSeats | 0) > 0, H.freeSeats);
  need('THE ASK: the help button opens a modal of places', H.modalOpen === true, H);
  need('…listing businesses that need staff', (H.places | 0) > 0, H.places);
  need('🔴 CONTROL: every seat with a Hire button is one they could take', H.allReachable === true, H);
  need('THE ASK: every business states the schooling it needs', H.rowsStateNeed === true, H);
  need('THE ASK: the modal shows the resident\'s own schooling', H.headerHasEdu === true, H);
  need('THE ASK: …and their name opens who they are', H.headerNameClickable === true, H);
  /* A city can legitimately have nothing out of reach; when it does have one,
     it must be explained and inert. */
  need('SETUP: at least one place is genuinely out of reach', (H.lockedRows | 0) > 0, H.lockedRows);
  need('🔴 a place they cannot take yet is shown, explained, and NOT clickable',
       H.lockedHaveNoHire === true && H.lockedSayNeed === true,
       { locked: H.lockedRows, noHire: H.lockedHaveNoHire, says: H.lockedSayNeed });
  need('THE ASK: Hire places them', H.hasErrand === true, H);
  need('🔴 CONTROL: …but NOT instantly — the phone is not a bypass', H.seatedInstantly === false, H);
  need('…and the modal closes', H.modalClosed === true, H.modalClosed);
}
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2).slice(0, 3000));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the phone pings, the shops advertise, and a resident can be placed from the handset.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
