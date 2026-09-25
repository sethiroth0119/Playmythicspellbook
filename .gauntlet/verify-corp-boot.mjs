/* ══════════════════════════════════════════════════════════════════════════
   🧾 VERIFY-CORP-BOOT — an INDEPENDENT check that the Just Business app still
   renders after the gauntlet, run by the lead rather than by the agents whose
   work it is checking.

   The integration agent reported "all ten routes render, 0 page errors". This
   session has twice shown that a report is a claim, not evidence, so this
   boots the app itself and reads what the DOM actually contains.

   ⚠ THE CDN TAGS ARE NOT SUBSTITUTED. React/ReactDOM/Babel carry `integrity`
     hashes; swapping them for node_modules copies is rejected by SRI SILENTLY
     and renders a blank page with a clean console — which reads exactly like a
     broken app. They come from the network, as they do for a player.

   Run:  node .gauntlet/verify-corp-boot.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jsx': 'text/babel', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const PORT = 7300 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 180)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180)); });

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

await page.goto(`http://127.0.0.1:${PORT}/corp/index.html`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => document.body && document.body.innerText.trim().length > 40,
  null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);

console.log('\n1. the app mounts at all');
const boot = await page.evaluate(() => ({
  chars: document.body.innerText.replace(/\s+/g, ' ').trim().length,
  navButtons: document.querySelectorAll('button, a, [role=button]').length,
  head: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 150),
}));
console.log('   ' + JSON.stringify(boot));
ok('the page rendered real text (not a blank SRI failure)', boot.chars > 200, boot.chars + ' chars');
ok('there are controls to click', boot.navButtons > 5, boot.navButtons + ' clickable');

/* Walk the nav by visible label — the same way a player would. */
const LABELS = ['Vault', 'Corp Treasury', 'Guild & Hiring', 'Operations', 'Logistics',
                'Marketplace', 'Real Estate', 'Guild Wire', 'Mailbox', 'Trade Window'];
console.log('\n2. every screen renders, and none of them prints a broken number');
const BAD = /\bNaN\b|\bundefined\b|\bInfinity\b|Invalid Date|\[object Object\]/;
for (const label of LABELS) {
  const r = await page.evaluate(async (lab) => {
    /* ⚠ CONTAINS, not equals. Nav labels carry a leading glyph ("◇ Vault"),
       so exact-match found nothing and reported ten false failures against an
       app that had in fact mounted correctly. Smallest matching element wins,
       so "Vault" does not select the whole sidebar. */
    const els = [...document.querySelectorAll('button, a, [role=button], li')]
      .filter((e) => e.textContent && e.textContent.trim().includes(lab) && e.offsetParent !== null)
      .sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
    const el = els[0];
    if (!el) return { missing: true };
    el.click();
    await new Promise((res) => setTimeout(res, 900));
    const main = document.querySelector('main') || document.body;
    const txt = main.innerText.replace(/\s+/g, ' ').trim();
    return { chars: txt.length, sample: txt.slice(0, 120), txt };
  }, label);
  if (r.missing) { ok(label.padEnd(15) + ' — nav item found', false, 'no visible nav item with this label'); continue; }
  const bad = BAD.exec(r.txt || '');
  ok(label.padEnd(15) + ' renders', (r.chars | 0) > 30, r.chars + ' chars · ' + r.sample);
  if ((r.chars | 0) > 30) ok('  ' + ''.padEnd(13) + ' no broken number', !bad, bad ? 'FOUND "' + bad[0] + '"' : 'clean');
}

console.log('\n3. no errors while doing all of that');
console.log('   ' + (errs.length ? errs.slice(0, 6).join('\n   ') : '(none)'));
ok('zero page/console errors across every screen', errs.length === 0, errs.length + ' error(s)');

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
