/* ══════════════════════════════════════════════════════════════════════════
   BATTLE REPORT SHOT — the event panel, driven through the REAL renderer.

   Loads public/index.html (served by the `public` preview server on 8787),
   calls window.Juice.eventChip with the exact five lines from the owner's
   screenshot, and:
     1. photographs the panel,
     2. MEASURES how long a row actually stays up (the ask was "+4 seconds"),
     3. confirms the panel frame goes away once the rows are gone.
   No battle is needed: Juice is a window global and the feed is body-level.

   Usage: node .gauntlet/feed-shot.mjs <out.png> [--w 1440] [--h 900]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'feed.png';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const W = +flag('w', 1440), H = +flag('h', 900);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.Juice && typeof window.Juice.eventChip === 'function', null, { timeout: 30000 });

/* A plain battle-dark stage behind the panel so the photo is of the panel, not
   of the sign-in screen the harness cannot get past. The feed is fixed-position
   and body-level, so hiding the rest of the page does not move it. */
await page.addStyleTag({ content:
  'body > *:not(#battle-event-feed){visibility:hidden!important}'
  + 'body{background:radial-gradient(ellipse at 50% 40%,#2a3b2a,#0b0f0b 70%)!important}'
  + ':root{--hud-banner-h:40px}' });

const t0 = await page.evaluate(() => {
  const J = window.Juice;
  // oldest first, so the newest (the Countering line) lands on top
  J.eventChip({ icon: '📜', label: '— Your turn 2 —', kind: 'event', ms: 2400 });
  J.eventChip({ icon: '✨', label: 'Aroa Stormrider Survivor — Shielded wears off', kind: 'event', ms: 2400 });
  J.eventChip({ icon: '🏁', label: 'End Phase', kind: 'event', ms: 2400 });
  J.eventChip({ icon: '🔁', label: 'Follow Up Phase', kind: 'event', ms: 2400 });
  J.eventChip({ icon: '↩️', label: 'Aroa Stormrider Survivor — Countering', kind: 'buff' });
  return Date.now();
});
await page.waitForTimeout(700);
await page.locator('#battle-event-feed').screenshot({ path: out });

const probe = () => page.evaluate(() => {
  const f = document.getElementById('battle-event-feed');
  return { rows: f ? f.querySelectorAll('.bef-row:not(.bef-out)').length : -1,
           empty: f ? f.classList.contains('bef-empty') : null,
           herald: !!(f && f.querySelector('.bef-herald')),
           w: f ? Math.round(f.getBoundingClientRect().width) : 0 };
});
const at = async (ms) => { const wait = t0 + ms - Date.now(); if (wait > 0) await page.waitForTimeout(wait); return { t: ms, ...(await probe()) }; };

const samples = [];
samples.push(await at(800));
samples.push(await at(3200));    // the OLD pills (2.4s) would all be gone here
samples.push(await at(6000));    // 2.4 + 4 = 6.4s — still up
samples.push(await at(7300));    // past 2.6 + 4 = 6.6s + fade — all gone
await page.waitForTimeout(500);
samples.push({ t: 'end', ...(await probe()) });

await browser.close();
console.log(JSON.stringify({ out, samples, errors }, null, 1));
