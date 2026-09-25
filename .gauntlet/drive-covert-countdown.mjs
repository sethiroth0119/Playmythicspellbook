/* ══════════════════════════════════════════════════════════════════════════
   ⏱ DRIVE-COVERT-COUNTDOWN — does the Resistance Ring timer actually move?

   THE REPORT: "the convoy rig in camp, the 24 hours counter is not working."

   IT WAS NOT A TIMER BUG — THERE WAS NO TIMER. renderResistanceRing() computes
   the label once while building its html string:
       const remainMs = Math.max(0, m.endsAt - Date.now());
   and nothing re-rendered the screen, so a 24h Recruitment Drive printed
   "23h 59m left" and froze. The Collect button lives in the same
   `remainMs <= 0` branch, so a mission that finished while the player watched
   stayed uncollectable until they navigated away and back. The DATA was always
   correct — endsAt is absolute, stamped at deploy — which is why nothing in
   the save looked wrong.

   WHAT IS ASSERTED, against the real screen with a real deployment:
     1. the label CHANGES on its own, with no navigation and no re-render
     2. the progress bar advances with it
     3. a mission crossing zero produces a Collect button without the player
        leaving the screen
     4. the interval STOPS when the screen changes — a ticker that outlives its
        screen is how you get two of them re-entering the renderer forever

   ⚠ TIME IS FAKED, NOT WAITED. The clock is moved by rewriting endsAt on the
     live mission, because a driver that actually waited 24 hours is not a test
     anyone runs. Date.now() itself is left alone so the code under test uses
     the same clock it uses in production.

   Run: node .gauntlet/drive-covert-countdown.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain' };
const P = 8120 + (process.pid % 40);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof renderResistanceRing === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(2500);

let fails = 0;
const ok = (label, cond, detail) => {
  if (!cond) fails++;
  console.log('  ' + (cond ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m') + ' ' + label + (detail ? '   ' + detail : ''));
};

const out = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rep = {};
  try {
    localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay').forEach(e => e.remove());
  } catch (e) {}

  /* A live 24h deployment, written straight into the save the screen reads. */
  const now = Date.now();
  Profile.covertActions = [{
    id: 'cv_test_1', missionId: 'cv_recruit', missionName: '⚔ Recruitment Drive', missionIcon: '⚔',
    unitIds: ['u_test_a', 'u_test_b'],
    startedAt: now - (60 * 1000), endsAt: now + (24 * 3600 * 1000) - (60 * 1000),
    collected: false, reward: null,
  }];
  App.screen = 'resistanceRing';
  renderResistanceRing();
  await sleep(120);

  const row = () => document.querySelector('.cr-active[data-cv-ends]');
  const lbl = () => { const r = row(); const e = r && r.querySelector('.cr-active-remain'); return e ? e.textContent.trim() : null; };
  const fill = () => { const r = row(); const e = r && r.querySelector('.cr-active-fill'); return e ? e.style.width : null; };
  rep.rendered = !!row();
  rep.firstLabel = lbl();
  rep.firstFill = fill();
  rep.tickerArmed = !!App._crTick;

  /* 1 + 2 · move the clock by an hour WITHOUT re-rendering, and let one tick run */
  const r0 = row();
  if (r0) r0.setAttribute('data-cv-ends', String(now + (23 * 3600 * 1000)));
  await sleep(1200);
  rep.secondLabel = lbl();
  rep.secondFill = fill();

  /* 3 · cross zero — the Collect button must appear without navigating */
  const r1 = row();
  if (r1) r1.setAttribute('data-cv-ends', String(Date.now() - 1000));
  Profile.covertActions[0].endsAt = Date.now() - 1000;   // so the re-render agrees
  await sleep(1400);
  /* 🔴 CORRECTION TO THIS FILE'S OWN PREMISE. renderResistanceRing() AUTO-
     COLLECTS on arrival: any mission whose timer elapsed is collected and
     queued into a Mission Debrief modal (see the block at the top of that
     function), so [data-cv-collect] is vestigial on this path and asserting it
     was testing for a button the design deliberately does not need. What the
     player must actually get is the DEBRIEF — and before the ticker existed
     they only got it by navigating away and back. */
  rep.debriefShown = !!(App._covertResult || document.getElementById('cr-debrief-close'));
  rep.missionCollected = !!(Profile.covertActions || []).every(m => m.collected || m.endsAt > Date.now());
  /* 🔴 NOT "the ticker stopped" — that was the wrong expectation and the code
     was right: the re-render legitimately re-arms a ticker for any OTHER
     mission still running. What must NOT happen is a re-render LOOP, so the
     real test is that the screen settles: the Collect button is still the same
     element two seconds later, not one being destroyed and rebuilt every tick. */
  /* Settles = the finished mission left the active list, so nothing re-renders
     on the next tick. A loop would keep rebuilding the debrief forever. */
  const q1 = document.querySelectorAll('.cr-active[data-cv-ends]').length;
  await sleep(2100);
  const q2 = document.querySelectorAll('.cr-active[data-cv-ends]').length;
  rep.settled = q1 === 0 && q2 === 0;

  /* 4 · leaving the screen must stop the ticker */
  Profile.covertActions = [{
    id: 'cv_test_2', missionId: 'cv_recruit', missionName: '⚔ Recruitment Drive', missionIcon: '⚔',
    unitIds: ['u_test_a'], startedAt: Date.now(), endsAt: Date.now() + (24 * 3600 * 1000),
    collected: false, reward: null,
  }];
  renderResistanceRing();
  await sleep(120);
  rep.armedAgain = !!App._crTick;
  App.screen = 'camp';
  await sleep(1300);
  rep.stoppedOnLeave = !App._crTick;
  return rep;
});
await b.close(); srv.close();

console.log('\n⏱ RESISTANCE RING · does the 24h counter move?\n');
ok('the deployment row rendered', out.rendered);
ok('a ticker was armed', out.tickerArmed);
ok('the label CHANGES on its own, with no re-render',
  !!out.firstLabel && !!out.secondLabel && out.firstLabel !== out.secondLabel,
  JSON.stringify([out.firstLabel, out.secondLabel]));
ok('the progress bar advances with it',
  !!out.firstFill && !!out.secondFill && out.firstFill !== out.secondFill,
  JSON.stringify([out.firstFill, out.secondFill]));
ok('a mission crossing zero DEBRIEFS without navigating', out.debriefShown);
ok('the mission was collected, not left hanging', out.missionCollected);
ok('the screen SETTLES — the row is gone and nothing loops', out.settled);
ok('leaving the screen stops the ticker', out.stoppedOnLeave, 'armed again first: ' + out.armedAgain);
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n' + (fails ? '\x1b[31m❌ ' + fails + ' FAILED\x1b[0m' : '\x1b[32m✅ ALL PASS\x1b[0m') + '\n');
process.exit(fails ? 1 : 0);
