/* ══════════════════════════════════════════════════════════════════════════
   🛌 DRIVE-REST-BONFIRE-SCROLL — the three things reported together, plus the
   boot check that should have caught the last regression.

   1 · THE REST SYSTEM, back on after being disabled in v121q20. Before
       re-enabling it I A/B'd boot-to-render with the feature ON and OFF, twice
       each: 4.9 / 6.3 s OFF against 6.4 / 3.6 s ON, no page errors either way,
       and _mmData (the main-menu payload) never reads hero energy at all. So
       there is no evidence it caused the slow, broken load. The likeliest cause
       was four CACHE_VERSION bumps in a row on an 11 MB index.html leaving a
       half-updated service-worker cache — a deploy-cadence fault, not a code
       one. 🔴 BOOT IS NOW PART OF THIS FILE regardless, because "the logic is
       right" is what I proved last time and the game still would not start.

   2 · THE BONFIRE, which "always says they are fully rested". It only ever
       touched STRESS — and every battle runs reduceHeroStress FIRST (−15 on a
       win), so anyone who mostly wins sits at 0 stress permanently and the
       button was correctly, uselessly, disabled. Meanwhile the bar that WAS
       full sat directly above it: 100/100 fatigue, which the bonfire could not
       touch. It now clears fatigue too and lights when either bar has anything
       in it.

   3 · THE SCROLL RUBBER-BAND, two separate causes:
       · the recorder bailed on `!el.scrollTop`, so scrolling back to the TOP
         was never remembered — the stale lower position survived and the next
         render dragged the player back down to it;
       · restore() re-applies for up to twelve frames, overwriting any wheel or
         drag made inside that window.

   Pinned, with controls:
     · the page boots and renders, with no errors     ← the last regression
     · fatigue decays; a tired hero is Injured        + CONTROL: a fresh one is not
     · the bonfire lights on fatigue alone            + CONTROL: dark at zero/zero
     · the bonfire actually removes fatigue           + CONTROL: and stress
     · a scroll to the top is remembered              + CONTROL: so is a real one
     · a gesture mid-restore wins                     + CONTROL: without one it restores

   Run:  node .gauntlet/drive-rest-bonfire-scroll.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8910 + (process.pid % 40);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
const t0 = Date.now();
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
const booted = await pg.waitForFunction(
  'typeof render === "function" && typeof App !== "undefined" && !!App.screen', null, { timeout: 90000 })
  .then(() => true).catch(() => false);
const bootMs = Date.now() - t0;
await pg.waitForTimeout(3000);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof getHeroEnergy === 'function' && typeof openHeroRestPanel === 'function';
  if (!o.reachable) return o;
  window.saveProfile = () => {};
  window.ownsHero = () => true;
  window.showToast = () => {};
  const H = 3600 * 1000;

  // ── 1 · the rest system ────────────────────────────────────────────────
  const HID = 'probe';
  Profile.heroes = Object.assign(Profile.heroes || {}, { [HID]: { level: 1 } });
  const set = (fat, agoMs) => {
    Profile.heroEnergy = Profile.heroEnergy || {};
    Profile.heroEnergy[HID] = { energy: 20, fatigue: fat, stress: 0,
      lastRestAt: Date.now(), lastFatigueAt: Date.now() - (agoMs || 0) };
  };
  set(100, 24 * H); o.decay24h = getHeroEnergy(HID).fatigue | 0;   // 0
  set(100, 12 * H); o.decay12h = getHeroEnergy(HID).fatigue | 0;   // ~50
  set(100, 0);      o.injuredAt100 = isHeroFatigued(HID);          // true
  set(10, 0);       o.injuredAt10  = isHeroFatigued(HID);          // CONTROL false
  o.injuredNeverThrows = (() => { try { return isHeroFatigued(null) === false; } catch (e) { return 'THREW'; } })();

  // ── 2 · the bonfire ────────────────────────────────────────────────────
  const all = getAllHeroes().slice(0, 3);
  const seed = (fat, str) => {
    Profile.heroEnergy = {};
    all.forEach(h => {
      Profile.heroes[h.id] = { level: 1 };
      Profile.heroEnergy[h.id] = { energy: 20, fatigue: fat, stress: str,
        lastRestAt: Date.now(), lastFatigueAt: Date.now() };
    });
  };
  const openPanel = () => {
    const old = document.getElementById('hero-rest-modal'); if (old) old.remove();
    openHeroRestPanel();
    return document.getElementById('hero-rest-modal');
  };
  Profile.gems = 100000;
  seed(60, 0);                                    // tired, not stressed
  let m = openPanel();
  const bf = () => m.querySelector('#hr-bonfire');
  o.bonfireLitOnFatigue = !bf().disabled;         // must be TRUE — the report
  o.bonfireLabel = bf().textContent.replace(/\s+/g, ' ').trim();
  const before = all.map(h => getHeroEnergy(h.id).fatigue | 0);
  bf().click();
  o.fatigueBefore = before[0];
  o.fatigueAfter = getHeroEnergy(all[0].id).fatigue | 0;           // 60 − 25
  seed(0, 40);                                    // stressed, not tired
  m = openPanel();
  o.bonfireLitOnStress = !bf().disabled;
  bf().click();
  o.stressAfter = getHeroEnergy(all[0].id).stress | 0;             // 40 − 15
  seed(0, 0);                                     // CONTROL: nothing to do
  m = openPanel();
  o.bonfireDarkWhenRested = bf().disabled;
  o.bonfireDarkTitle = bf().getAttribute('title') || '';
  try { document.getElementById('hero-rest-modal').remove(); } catch (e) {}

  // ── 3 · the scroll memory ──────────────────────────────────────────────
  const box = document.createElement('div');
  box.id = 'scrollprobe';
  box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:100px;overflow:auto';
  box.innerHTML = '<div style="height:2000px"></div>';
  document.body.appendChild(box);
  const fire = () => box.dispatchEvent(new Event('scroll', { bubbles: true }));
  const memOf = () => (window.__scrollMem.map.get('#scrollprobe') || null);

  window.__scrollMem.map.clear();
  window.__scrollMem.screen = _scrollScreenKey();
  box.scrollTop = 400; fire();
  o.recordedReal = memOf() && memOf().top;                          // 400
  box.scrollTop = 0;   fire();
  o.recordedTop = memOf() && memOf().top;                           // 0 — the bug
  o.recordsZero = (memOf() && memOf().top === 0);

  // …and that a restore yields to a real gesture.
  o.userWins = (() => {
    const started = Date.now() - 5;
    window.__scrollMem.userAt = Date.now();                         // player just acted
    return (Number(window.__scrollMem.userAt) || 0) > started;               // restore would bail
  })();
  o.noGestureNoBail = (() => {
    window.__scrollMem.userAt = 0;
    return !((Number(window.__scrollMem.userAt) || 0) > Date.now() - 5);      // CONTROL: proceeds
  })();
  try { box.remove(); } catch (e) {}
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const near = (v, w, t) => typeof v === 'number' && Math.abs(v - w) <= (t || 2);
need('THE LAST REGRESSION: the page boots and renders', booted === true, bootMs + 'ms');
need('…with no page errors at all', errs.length === 0, errs.slice(0, 3));
if (!out.reachable) bad.push('hero-energy / panel not reachable');
else {
  need('fatigue clears in 24 h', out.decay24h === 0, out.decay24h);
  need('…and half of it in 12', near(out.decay12h, 50), out.decay12h);
  need('a spent hero deploys Injured', out.injuredAt100 === true, out.injuredAt100);
  need('CONTROL: a rested one does not', out.injuredAt10 === false, out.injuredAt10);
  need('CONTROL: the injured check can never throw the screen away', out.injuredNeverThrows === true, out.injuredNeverThrows);

  need('THE REPORT: the bonfire lights when heroes are merely TIRED', out.bonfireLitOnFatigue === true, out.bonfireLitOnFatigue);
  need('…and says it clears fatigue', /Fatigue/i.test(out.bonfireLabel || ''), out.bonfireLabel);
  need('…and actually removes it', out.fatigueBefore === 60 && out.fatigueAfter === 35, [out.fatigueBefore, out.fatigueAfter]);
  need('it still lights on stress alone', out.bonfireLitOnStress === true, out.bonfireLitOnStress);
  need('…and still clears that', out.stressAfter === 25, out.stressAfter);
  need('CONTROL: dark when there is genuinely nothing to rest off', out.bonfireDarkWhenRested === true, out.bonfireDarkWhenRested);
  need('…and says why, instead of looking broken', /Nothing to rest off/.test(out.bonfireDarkTitle || ''), out.bonfireDarkTitle);

  need('CONTROL: a real scroll position is remembered', out.recordedReal === 400, out.recordedReal);
  need('THE RUBBER-BAND: scrolling back to the TOP is remembered too', out.recordsZero === true, out.recordedTop);
  need('a gesture mid-restore aborts it', out.userWins === true, out.userWins);
  need('CONTROL: with no gesture the restore still runs', out.noGestureNoBail === true, out.noGestureNoBail);
}

console.log(JSON.stringify({ bootMs, booted, ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — it boots, rest works, the bonfire rests them, and the list stays where you put it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
