// ─────────────────────────────────────────────────────────────────────────────
// 🎮 The battle rig. Boots the REAL public/index.html in headless Chromium and
// exposes playMatch() to Node. See page-driver.js for what runs inside.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PUBLIC = path.join(REPO, 'public');

export async function openEngine(opts = {}) {
  const srv = await startServer(PUBLIC, 0);
  const browser = await chromium.launch({
    executablePath: process.env.WP_CHROMIUM || '/opt/pw-browsers/chromium',
    headless: !opts.headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // Nothing leaves the box. Supabase, fonts, card art — all answered locally
  // so a match cannot depend on, or be slowed by, the network.
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${srv.port}/`)) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|MIME type/.test(t)) return;   // blocked assets
    pageErrors.push('console: ' + t.slice(0, 300));
  });

  await page.goto(`http://127.0.0.1:${srv.port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.initGame === 'function'
    || typeof initGame === 'function', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const driver = fs.readFileSync(path.join(HERE, 'page-driver.js'), 'utf8');
  await page.evaluate(driver);
  const ok = await page.evaluate(() => !!(window.__wpd && window.__wpd.ready));
  if (!ok) throw new Error('page driver failed to install: ' + pageErrors.slice(0, 3).join(' | '));

  return {
    page, pageErrors,
    catalog: () => page.evaluate(() => window.__wpd.catalog()),
    inspect: keys => page.evaluate(k => window.__wpd.inspectDeck(k), keys),
    pad: keys => page.evaluate(k => window.__wpd.padLikeWarpath(k), keys),
    playMatch: cfg => page.evaluate(c => window.__wpd.playMatch(c), cfg),
    close: async () => { await browser.close(); await srv.stop(); },
  };
}
