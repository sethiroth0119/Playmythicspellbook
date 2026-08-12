// Throwaway probe: does public/index.html boot headless, and are the engine
// globals reachable from Playwright?
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const srv = await startServer('/home/user/Playmythicspellbook/public', 0);
const browser = await chromium.launch({
  executablePath: process.env.WP_CHROMIUM || '/opt/pw-browsers/chromium',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
// Block everything off-box.
await ctx.route('**/*', route => {
  const u = route.request().url();
  if (u.startsWith(`http://127.0.0.1:${srv.port}/`)) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});

await page.goto(`http://127.0.0.1:${srv.port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const g = n => { try { return typeof window[n]; } catch (e) { return 'throw'; } };
  return {
    globals: Object.fromEntries(['App', 'initGame', 'buildDeckFromKeys', 'resolveDeckCard', 'UNIT_CARDS',
      'SPELL_CARDS', 'TRAP_CARDS', 'LOCATION_CARDS', 'WEATHER_CARDS', 'STARTER_HEROES', 'doAIStep',
      'scheduleAIStep', 'swapBattlePerspective', 'endAITurn', 'endPlayerTurn', 'renderBattle',
      'applyAnimSpeed', 'getSettings', 'Profile', 'DECK_SIZE', 'STARTING_HAND_SIZE', 'shuffle',
      'finishAIPhase', 'canPlayerAct', 'buildHero', '_legalizeDeck', 'getGeneratedDeckForHero',
      'MOVES', 'PASSIVES', 'STATUS_EFFECTS', 'calculateDamage', 'executeMove', '_fireTriggers', 'startTurn',
    ].map(n => [n, g(n)])),
    screen: (window.App && App.screen) || null,
    heroes: (typeof STARTER_HEROES !== 'undefined' && STARTER_HEROES) ? STARTER_HEROES.map(h => h.id) : null,
    counts: (typeof UNIT_CARDS !== 'undefined') ? {
      unit: UNIT_CARDS.length, spell: SPELL_CARDS.length, trap: TRAP_CARDS.length,
      location: LOCATION_CARDS.length, weather: WEATHER_CARDS.length,
    } : null,
    deckSize: typeof DECK_SIZE !== 'undefined' ? DECK_SIZE : null,
    handSize: typeof STARTING_HAND_SIZE !== 'undefined' ? STARTING_HAND_SIZE : null,
  };
});
console.log(JSON.stringify(out, null, 2));
console.log('--- errors ---');
console.log(errs.slice(0, 25).join('\n'));
await browser.close();
await srv.stop();
