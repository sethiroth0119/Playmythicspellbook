// ─────────────────────────────────────────────────────────────────────────────
// 🎮 The battle rig.
//
// Boots the REAL public/index.html in headless Chromium and exposes
// playMatch() to Node. Every rule that decides a match is the shipped game's;
// see page-driver.js for exactly what is stubbed and why.
//
// A pool of N tabs shares one browser and one static server. Each tab is an
// independent copy of the game with its own Profile, so matches running in
// parallel cannot contaminate each other's progression state.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PUBLIC = path.join(REPO, 'public');
const DRIVER = fs.readFileSync(path.join(HERE, 'page-driver.js'), 'utf8');

async function newTab(browser, port, pageErrors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // Nothing leaves the box. Supabase, fonts and card art are all answered
  // locally, so a match can neither depend on nor be slowed by the network.
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|MIME type|net::ERR/.test(t)) return;   // blocked assets
    pageErrors.push('console: ' + t.slice(0, 300));
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.initGame === 'function', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(DRIVER);
  const ok = await page.evaluate(() => !!(window.__wpd && window.__wpd.ready));
  if (!ok) throw new Error('page driver failed to install: ' + pageErrors.slice(0, 3).join(' | '));
  return page;
}

export async function openEngine(opts = {}) {
  const workers = Math.max(1, opts.workers || 1);
  const srv = await startServer(PUBLIC, 0);
  const browser = await chromium.launch({
    executablePath: process.env.WP_CHROMIUM || '/opt/pw-browsers/chromium',
    headless: !opts.headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
  });
  const pageErrors = [];
  // Booted concurrently: public/index.html is ~11 MB and each tab spends most of
  // its boot parsing it, so five sequential boots cost about eight minutes and
  // five parallel ones about two.
  const pages = await Promise.all(
    Array.from({ length: workers }, () => newTab(browser, srv.port, pageErrors)));
  const p0 = pages[0];

  /* Run a list of match configs across the tab pool, preserving input order.
     `onDone(result, index)` fires as each finishes so callers can show progress. */
  async function playMany(cfgs, onDone) {
    const out = new Array(cfgs.length);
    let next = 0, finished = 0;
    await Promise.all(pages.map(async (pg) => {
      for (;;) {
        const i = next++;
        if (i >= cfgs.length) return;
        let r;
        try { r = await pg.evaluate(c => window.__wpd.playMatch(c), cfgs[i]); }
        catch (e) { r = { winner: null, error: 'harness: ' + String(e.message || e).slice(0, 200) }; }
        out[i] = r;
        finished++;
        if (onDone) onDone(r, i, finished, cfgs.length);
      }
    }));
    return out;
  }

  return {
    pages, pageErrors, workers,
    catalog: () => p0.evaluate(() => window.__wpd.catalog()),
    inspect: keys => p0.evaluate(k => window.__wpd.inspectDeck(k), keys),
    pad: keys => p0.evaluate(k => window.__wpd.padLikeWarpath(k), keys),
    generatedDeck: heroId => p0.evaluate(h => window.__wpd.generatedDeck(h), heroId),
    tunedDeck: () => p0.evaluate(() => window.__wpd.tunedDeck()),
    playMatch: cfg => p0.evaluate(c => window.__wpd.playMatch(c), cfg),
    playMany,
    close: async () => { await browser.close(); await srv.stop(); },
  };
}
