/* ══════════════════════════════════════════════════════════════════════════
   BATTLE-START PROBE — does the pile rail render, or does it throw?

   v121v168 shipped with renderBattlePiles throwing "I_TUNNEL is not defined" on
   the first battle render. renderBattle catches that and keeps the last good
   board, which was the dice screen — so the symptom was a loading flash and a
   bounce back to the coin flip, with nothing in any stack trace a player would
   see. No syntax gate can catch it: the file parses. No grep of the DEPLOYED
   page can catch it either, because minification renames the local.

   This loads a candidate index.html as the real page (served over the live
   public/ tree, so every asset resolves) and calls the function directly.

   Usage:  node .gauntlet/battlestart-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server up (port 8787).
   Exit 0 = rendered, 1 = threw, 2 = could not run the probe at all.

   🔴 RUN IT AGAINST A KNOWN-BAD CANDIDATE FIRST. A probe that cannot fail
   proves nothing; the pre-fix commit is the negative control.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: battlestart-probe.mjs <candidate.html>'); process.exit(2); }
const ai = process.argv.indexOf('--url');
const BASE = ai > 0 ? process.argv[ai + 1] : 'http://localhost:8787';
const html = fs.readFileSync(file, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
/* Serve the CANDIDATE for the document, the real tree for everything else. */
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') {
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  }
  return route.continue();
});

let out;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.renderBattlePiles === 'function', null, { timeout: 30000 });
  out = await page.evaluate(() => {
    const side = () => ({ deck: [{ id: 'x1' }, { id: 'x2' }], hand: [], graveyard: [], void: [],
      realmDeck: [{ id: 'r1' }], tunneled: [], energy: 3, maxEnergy: 3, hp: 30 });
    const s = { player: side(), ai: side(), units: [], turn: 'player', gameOver: false, round: 1 };
    try {
      const h = window.renderBattlePiles(s);
      return { ok: true, len: String(h || '').length, hasTunnel: String(h || '').indexOf('TUNNELED') >= 0 };
    } catch (e) {
      return { ok: false, err: String(e && e.message || e) };
    }
  });
} catch (e) {
  console.log(JSON.stringify({ file, probe: 'COULD NOT RUN', err: String(e && e.message || e) }));
  await browser.close();
  process.exit(2);
}
await browser.close();
console.log(JSON.stringify({ file: file.split(/[\\/]/).pop(), ...out,
  /* ALL load errors, capped. The first build that failed this probe for a NEW
     reason (App in its TDZ) was undiagnosable while this filtered to the one
     error the probe was written for. */
  loadErrors: pageErrors.slice(0, 6).map(m => m.slice(0, 220)) }));
process.exit(out.ok ? 0 : 1);
